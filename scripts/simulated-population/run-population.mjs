#!/usr/bin/env node
// Drives 30 simulated-population agents through a real baseline room using
// the exact same HTTP API a human browser client uses (join-room,
// get-state, make-choice, save-reason, admin room-action), so the
// resulting round_logs/traffic_edges rows are indistinguishable in shape
// from a human session. See migrations/02_add_simulation_agents.sql for
// where persona metadata is stored, and the plan at
// /Users/memmi/.claude/plans/cached-wiggling-crescent.md for full context.
//
// Usage:
//   node scripts/simulated-population/run-population.mjs [--base-url=http://host:port] [--condition=baseline]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PERSONAS } from "./personas.mjs";
import { decideRoute } from "./decide.mjs";
import { decideRouteLLM, decideSwitchLLM, generatePersuadeeReply, decideFinalChoiceAfterPersuasion } from "./decide-llm.mjs";
import { USE_MOCK, warmUp } from "./ollama-client.mjs";
import { findOptimalSplit, routeEdgeSetsFromState } from "./optimal-split.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const args = { baseUrl: "http://137.121.170.69:8901", condition: "baseline", engine: "rules", persuaderModel: null, agents: null, rounds: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "base-url" && value) args.baseUrl = value.replace(/\/$/, "");
    if (key === "condition" && value) args.condition = value;
    if (key === "engine" && value) args.engine = value; // "rules" (default) or "llm"
    // Per-room advisor model override (game_rooms.persuader_model). Lets a
    // sequential multi-model batch pass a different model per run without
    // touching OLLAMA_MODEL or restarting the app server between runs.
    // Falls back to the app's OLLAMA_MODEL env var when omitted.
    if (key === "persuader-model" && value) args.persuaderModel = value;
    // Smoke-test knobs: cap population size / round count so a wiring
    // change can be sanity-checked in ~1-2 minutes instead of committing
    // to a full ~90-minute run. Omit both for a real experiment.
    if (key === "agents" && value) args.agents = parseInt(value, 10);
    if (key === "rounds" && value) args.rounds = parseInt(value, 10);
  }
  if (!["rules", "llm"].includes(args.engine)) {
    throw new Error(`--engine must be "rules" or "llm", got "${args.engine}"`);
  }
  return args;
}

function readDatabaseUrl() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^DATABASE_URL=(.+)$/);
    if (match) return match[1].trim();
  }
  throw new Error("DATABASE_URL not found in .env.local");
}

function fmtElapsed(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

async function callApi(baseUrl, method, endpoint, body) {
  const url = `${baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${endpoint} -> ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  const { baseUrl, condition, engine, persuaderModel, agents, rounds } = parseArgs(process.argv.slice(2));
  const dbUrl = readDatabaseUrl();
  const pool = new Pool({ connectionString: dbUrl });
  const activePersonas = agents ? PERSONAS.slice(0, agents) : PERSONAS;

  console.log(`Target app: ${baseUrl}`);
  console.log(`Condition: ${condition}`);
  console.log(`Agents: ${activePersonas.length}${agents ? ` (capped from ${PERSONAS.length} for smoke test)` : ""}`);
  console.log(
    `Engine: ${engine}${
      engine === "llm"
        ? USE_MOCK
          ? " (AGENT_MODE!=ollama -> mock fallback, no model calls)"
          : ` (population model: ${process.env.AGENT_POPULATION_MODEL || "qwen2.5:3b"}, advisor model: ${persuaderModel || process.env.OLLAMA_MODEL || "llama3.1"})`
        : ""
    }`
  );

  // 1. Create room
  const createResult = await callApi(baseUrl, "POST", "/api/admin/create-room", {
    agent_condition: condition,
    persuader_model: persuaderModel,
  });
  const roomId = createResult.room_id;
  console.log(`Created room ${roomId}`);

  const roomRow = await pool.query("SELECT total_rounds FROM game_rooms WHERE id = $1", [roomId]);
  const totalRounds = rounds ? Math.min(rounds, roomRow.rows[0].total_rounds) : roomRow.rows[0].total_rounds;
  console.log(`Total rounds: ${totalRounds}${rounds ? ` (capped from ${roomRow.rows[0].total_rounds} for smoke test)` : ""}`);

  // 2. Join all agents, persist persona metadata
  const sessions = [];
  for (const persona of activePersonas) {
    const joinResult = await callApi(baseUrl, "POST", "/api/join-room", {
      room_id: roomId,
      user_name: `${persona.label} [${persona.id}]`,
    });
    const sessionId = joinResult.session_id;
    sessions.push({ sessionId, persona, previousChoice: null });

    await pool.query(
      `INSERT INTO simulation_agents
        (session_id, room_id, agent_index, persona_label, llm_backend,
         risk_aversion, delay_sensitivity, trust_in_advice,
         decision_latency_mean, decision_latency_sigma,
         route_stickiness, softmax_temperature, commute_habit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        sessionId,
        roomId,
        persona.agentIndex,
        persona.label,
        persona.llmBackend,
        persona.riskAversion,
        persona.delaySensitivity,
        persona.trustInAdvice,
        persona.decisionLatencyMean,
        persona.decisionLatencySigma,
        persona.routeStickiness,
        persona.softmaxTemperature,
        persona.commuteHabit,
      ]
    );
  }
  console.log(`Joined ${sessions.length} agents`);

  // 3. Start the room
  await callApi(baseUrl, "POST", "/api/admin/room-action", { room_id: roomId, action: "start" });
  console.log("Room started");

  // 3b. Warm up the population model so agent 1 doesn't eat the cold-load
  // latency (which can exceed a normal per-call timeout on a busy/shared GPU).
  if (engine === "llm" && !USE_MOCK) {
    console.log("Warming up population model (forcing it into GPU memory)...");
    const warmMs = await warmUp();
    console.log(`Model warm — took ${fmtElapsed(warmMs)}`);
  }

  // 4. Round loop
  const experimentStart = Date.now();
  for (let round = 1; round <= totalRounds; round++) {
    const roundStart = Date.now();
    console.log(`\n=== Round ${round}/${totalRounds} === (${new Date().toLocaleTimeString()}, elapsed ${fmtElapsed(Date.now() - experimentStart)})`);
    const routeCounts = {};

    let agentIndex = 0;
    for (const session of sessions) {
      agentIndex += 1;
      const agentStart = Date.now();
      const who = `${session.persona.name} (${session.persona.occupation} · ${session.persona.segment})`;

      const state = await callApi(
        baseUrl,
        "GET",
        `/api/get-state?session_id=${session.sessionId}`
      );

      let decision;
      let advisorNote = "";
      let dialogue = [];
      if (engine === "llm") {
        if (condition !== "baseline") {
          // Persuasion dialogue: PersuLLM's opening pitch -> agent's reply ->
          // PersuLLM's rebuttal -> agent's final decision, informed by the
          // whole transcript. Bounded to one rebuttal, not open-ended.
          const rec = await callApi(
            baseUrl,
            "GET",
            `/api/agent/recommend?sessionId=${session.sessionId}&roomId=${roomId}&round=${round}`
          );

          if (!rec.error && rec.route) {
            const openingMessage = `I'd suggest ${rec.route}. ${rec.explanation}`;
            dialogue.push({ speaker: "advisor", text: openingMessage });

            const agentReply = await generatePersuadeeReply(session.persona, openingMessage);
            dialogue.push({ speaker: "agent", text: agentReply.reply });

            const chatRes = await callApi(baseUrl, "POST", "/api/agent/chat", {
              sessionId: session.sessionId,
              roomId,
              round,
              message: agentReply.reply,
              history: [{ role: "assistant", content: openingMessage }],
            });
            if (chatRes.reply) dialogue.push({ speaker: "advisor", text: chatRes.reply });

            advisorNote = `  [persuasion: ${rec.route} proposed, ${dialogue.length} turns]`;
          }

          decision = await decideFinalChoiceAfterPersuasion(
            session.persona,
            state.routes,
            state.network.edges,
            session.previousChoice,
            dialogue,
            Math.random
          );
        } else {
          decision = await decideRouteLLM(
            session.persona,
            state.routes,
            state.network.edges,
            session.previousChoice,
            null,
            Math.random
          );
        }
      } else {
        decision = decideRoute(
          session.persona,
          state.routes,
          state.network.edges,
          session.previousChoice,
          Math.random
        );
      }

      await callApi(baseUrl, "POST", "/api/make-choice", {
        session_id: session.sessionId,
        chosen_route: decision.route,
        decision_latency: decision.decisionLatency,
      });

      await callApi(baseUrl, "POST", "/api/save-reason", {
        session_id: session.sessionId,
        round,
        reason: decision.reason,
        reason_text: decision.reason,
        persuasion_transcript: dialogue.length ? dialogue : null,
      });

      const agentElapsed = Date.now() - agentStart;
      const idxStr = String(agentIndex).padStart(2, " ");
      console.log(
        `  [${idxStr}/${sessions.length}] ${who} -> ${decision.route}  (${fmtElapsed(agentElapsed)})${advisorNote}  "${decision.reason}"`
      );

      session.previousChoice = decision.route;
      routeCounts[decision.route] = (routeCounts[decision.route] || 0) + 1;
    }

    console.log(`Round ${round} initial choices done in ${fmtElapsed(Date.now() - roundStart)} — distribution:`, routeCounts);

    // Phase B: reflection + switch window, mirroring the real human flow
    // (see components/traffic-simulation.tsx's "submitted_waiting" phase) —
    // each agent sees its own predicted-vs-realized time and the actual vs.
    // optimal distribution, then gets one chance to switch. For
    // condition != baseline, the advisor now gets a bounded pitch/reply/
    // rebuttal exchange here too (mirroring the initial-choice dialogue),
    // since handing 30 agents the same raw comparison numbers with no
    // mediation produced correlated herding (see PersuLLM_NoSwitchAdvisor
    // archive, room KLH6, for the unmediated baseline this is compared
    // against).
    if (engine === "llm") {
      const switchPhaseStart = Date.now();
      console.log(`--- Round ${round} reflection/switch phase ---`);
      let switchCount = 0;

      for (const session of sessions) {
        const state = await callApi(baseUrl, "GET", `/api/get-state?session_id=${session.sessionId}`);
        const routeEdgeSets = routeEdgeSetsFromState(state.routes, state.network.edges);
        const optimal = findOptimalSplit(routeEdgeSets, sessions.length);

        let switchDialogue = [];
        if (condition !== "baseline") {
          const rec = await callApi(baseUrl, "POST", "/api/agent/switch-recommend", {
            sessionId: session.sessionId,
            roomId,
            round,
            currentChoice: state.player_choice,
            predictedTime: state.player_predicted_time,
            realizedTime: state.player_realized_time,
          });

          if (!rec.error && rec.route) {
            const openingMessage = `I'd suggest ${rec.route}. ${rec.explanation}`;
            switchDialogue.push({ speaker: "advisor", text: openingMessage });

            const agentReply = await generatePersuadeeReply(session.persona, openingMessage);
            switchDialogue.push({ speaker: "agent", text: agentReply.reply });

            const chatRes = await callApi(baseUrl, "POST", "/api/agent/chat", {
              sessionId: session.sessionId,
              roomId,
              round,
              message: agentReply.reply,
              history: [{ role: "assistant", content: openingMessage }],
            });
            if (chatRes.reply) switchDialogue.push({ speaker: "advisor", text: chatRes.reply });
          }
        }

        const switchDecision = await decideSwitchLLM(
          session.persona,
          state.routes,
          state.player_choice,
          state.player_predicted_time,
          state.player_realized_time,
          state.choice_distribution,
          optimal.counts,
          Math.random,
          switchDialogue
        );

        await callApi(baseUrl, "POST", "/api/save-reason", {
          session_id: session.sessionId,
          round,
          phase: "switch",
          reason: switchDecision.reason,
          reason_text: switchDecision.reason,
          persuasion_transcript: switchDialogue.length ? switchDialogue : null,
        });

        if (switchDecision.switched) {
          await callApi(baseUrl, "POST", "/api/change-choice", {
            session_id: session.sessionId,
            new_route: switchDecision.route,
          });
          switchCount += 1;
          routeCounts[state.player_choice] = (routeCounts[state.player_choice] || 0) - 1;
          routeCounts[switchDecision.route] = (routeCounts[switchDecision.route] || 0) + 1;
          console.log(`  [switch] ${session.persona.name}: ${state.player_choice} -> ${switchDecision.route}  "${switchDecision.reason}"`);
          session.previousChoice = switchDecision.route;
        }
      }

      console.log(
        `Round ${round} switch phase done in ${fmtElapsed(Date.now() - switchPhaseStart)} — ${switchCount}/${sessions.length} switched — final distribution:`,
        routeCounts
      );
    }

    // Sanity check before advancing.
    const check = await callApi(
      baseUrl,
      "GET",
      `/api/get-state?session_id=${sessions[sessions.length - 1].sessionId}`
    );
    if (!check.all_submitted) {
      console.warn(
        `Warning: round ${round} shows all_submitted=false (total_submitted=${check.total_submitted}) before advancing`
      );
    }

    await callApi(baseUrl, "POST", "/api/admin/room-action", { room_id: roomId, action: "next_round" });
  }

  console.log(
    `\nDone. Room ${roomId} completed ${totalRounds} rounds with ${sessions.length} agents in ${fmtElapsed(Date.now() - experimentStart)}.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});
