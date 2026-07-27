#!/usr/bin/env node
// RegConSuader Room 1 runner. Structurally a copy of
// scripts/simulated-population/run-population.mjs — same population-driving
// mechanics (join-room, get-state, make-choice, save-reason, admin
// room-action), same persona/decision-engine modules reused as-is (they are
// generic simulation infra, not PersuLLM-specific) — but calling
// /api/regconsuader/* instead of /api/agent/*, so PersuLLM-1's own runner
// and endpoints stay completely untouched. See project roadmap memory for
// why this lives in its own scripts/regconsuader/ directory.
//
// Usage:
//   node scripts/regconsuader/run-population.mjs [--base-url=http://host:port] [--agents=2] [--rounds=3]
//
// Condition is always "regconsuader" (not a CLI flag here — this script has
// exactly one condition to run, unlike the PersuLLM-1 runner which supports
// baseline/central/personal/etc).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PERSONAS } from "../simulated-population/personas.mjs";
import { decideSwitchLLM, generatePersuadeeReply, decideFinalChoiceAfterPersuasion } from "../simulated-population/decide-llm.mjs";
import { USE_MOCK, warmUp } from "../simulated-population/ollama-client.mjs";
import { findOptimalSplit, routeEdgeSetsFromState } from "../simulated-population/optimal-split.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CONDITION = "regconsuader";

function parseArgs(argv) {
  const args = { baseUrl: "http://137.121.170.69:8901", persuaderModel: null, agents: null, rounds: null };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "base-url" && value) args.baseUrl = value.replace(/\/$/, "");
    if (key === "persuader-model" && value) args.persuaderModel = value;
    // Smoke-test knobs: cap population size / round count. Omit both for a
    // real experiment.
    if (key === "agents" && value) args.agents = parseInt(value, 10);
    if (key === "rounds" && value) args.rounds = parseInt(value, 10);
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
  const { baseUrl, persuaderModel, agents, rounds } = parseArgs(process.argv.slice(2));
  const dbUrl = readDatabaseUrl();
  const pool = new Pool({ connectionString: dbUrl });
  const activePersonas = agents ? PERSONAS.slice(0, agents) : PERSONAS;

  console.log(`Target app: ${baseUrl}`);
  console.log(`Condition: ${CONDITION}`);
  console.log(`Agents: ${activePersonas.length}${agents ? ` (capped from ${PERSONAS.length} for smoke test)` : ""}`);
  console.log(
    `Engine: llm${
      USE_MOCK
        ? " (AGENT_MODE!=ollama -> mock fallback, no model calls)"
        : ` (population model: ${process.env.AGENT_POPULATION_MODEL || "qwen2.5:3b"}, advisor model: ${persuaderModel || process.env.OLLAMA_MODEL || "llama3.1"})`
    }`
  );

  // 1. Create room
  const createResult = await callApi(baseUrl, "POST", "/api/admin/create-room", {
    agent_condition: CONDITION,
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

  // 3b. Warm up the population model so agent 1 doesn't eat the cold-load latency.
  if (!USE_MOCK) {
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

      const state = await callApi(baseUrl, "GET", `/api/get-state?session_id=${session.sessionId}`);

      // Persuasion dialogue: RegConSuader's opening pitch (strategy-framed)
      // -> agent's reply -> RegConSuader's reactive rebuttal -> agent's
      // final decision, informed by the whole transcript.
      let advisorNote = "";
      let dialogue = [];
      let usedStrategy = null;

      const rec = await callApi(
        baseUrl,
        "GET",
        `/api/regconsuader/recommend?sessionId=${session.sessionId}&roomId=${roomId}&round=${round}`
      );

      if (!rec.error && rec.route) {
        usedStrategy = rec.strategy;
        const openingMessage = `I'd suggest ${rec.route}. ${rec.explanation}`;
        dialogue.push({ speaker: "advisor", text: openingMessage });

        const agentReply = await generatePersuadeeReply(session.persona, openingMessage);
        dialogue.push({ speaker: "agent", text: agentReply.reply });

        const chatRes = await callApi(baseUrl, "POST", "/api/regconsuader/chat", {
          sessionId: session.sessionId,
          roomId,
          round,
          message: agentReply.reply,
          history: [{ role: "assistant", content: openingMessage }],
        });
        if (chatRes.reply) dialogue.push({ speaker: "advisor", text: chatRes.reply });

        advisorNote = `  [strategy: ${usedStrategy}, ${rec.route} proposed, ${dialogue.length} turns]`;
      }

      const decision = await decideFinalChoiceAfterPersuasion(
        session.persona,
        state.routes,
        state.network.edges,
        session.previousChoice,
        dialogue,
        Math.random
      );

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

    // Phase B: reflection + switch window, mirroring PersuLLM-1's runner.
    const switchPhaseStart = Date.now();
    console.log(`--- Round ${round} reflection/switch phase ---`);
    let switchCount = 0;

    for (const session of sessions) {
      const state = await callApi(baseUrl, "GET", `/api/get-state?session_id=${session.sessionId}`);
      const routeEdgeSets = routeEdgeSetsFromState(state.routes, state.network.edges);
      const optimal = findOptimalSplit(routeEdgeSets, sessions.length);

      let switchDialogue = [];
      const rec = await callApi(baseUrl, "POST", "/api/regconsuader/switch-recommend", {
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

        const chatRes = await callApi(baseUrl, "POST", "/api/regconsuader/chat", {
          sessionId: session.sessionId,
          roomId,
          round,
          message: agentReply.reply,
          history: [{ role: "assistant", content: openingMessage }],
        });
        if (chatRes.reply) switchDialogue.push({ speaker: "advisor", text: chatRes.reply });
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

    // Sanity check before advancing.
    const check = await callApi(baseUrl, "GET", `/api/get-state?session_id=${sessions[sessions.length - 1].sessionId}`);
    if (!check.all_submitted) {
      console.warn(`Warning: round ${round} shows all_submitted=false (total_submitted=${check.total_submitted}) before advancing`);
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
