#!/usr/bin/env node
// Checks internal consistency for one already-exported room: does the
// simulated agent's own STATED intent in the dialogue (the natural-
// language reply) match what actually got logged as chosen_route? These
// two outputs come from the same decision step but aren't guaranteed to
// agree — a rule-based regex detector (used earlier, ad hoc) found real
// mismatches but couldn't reliably parse enough transcripts across all 8
// rooms to trust a comparative rate. This script replaces that with an
// LLM-judge pass, one call per decision, same infra pattern as
// judge-transcripts.mjs.
//
// Unlike judge-transcripts.mjs (which scores Persuasive/Logic on the
// ADVISOR's turns), this judges the COMMUTER's own final turn against the
// structured chosen_route already logged — a factual consistency check,
// not a quality rating, so the rubric asks for a route letter + yes/no,
// not a 1-10 score.
//
// Usage:
//   node scripts/simulated-population/judge-consistency.mjs <room.json> [--judge-model=deepseek-r1:32b] [--out=<dir>]
//
// One call per decision that has a transcript (up to 150/room, not 600 --
// only the commuter's stated intent is being checked, not both
// dimensions x both phases like judge-transcripts.mjs). Run on the
// container (needs Ollama), not locally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "8192", 10);
const TIMEOUT_MS = 90_000;

// Same as judge-transcripts.mjs -- deepseek-r1:32b as judge needs both.
function stripThink(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
}
function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

async function callJudge(judgeModel, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judgeModel,
        messages,
        stream: false,
        format: "json",
        options: { num_ctx: NUM_CTX },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return stripCodeFence(stripThink(data.message?.content ?? ""));
  } finally {
    clearTimeout(timeout);
  }
}

const CONSISTENCY_RUBRIC = `You are checking a single traffic-advisor conversation for internal consistency.
Below is a conversation between a traffic advisor and a commuter, followed by the route that was ultimately logged as the commuter's final choice.

Your job: read only the Commuter's turns. Determine what route (A, B, or C) the commuter's OWN WORDS most clearly indicate they intend to take, based on their final/last statement specifically -- not the advisor's suggestion, not an earlier turn if a later one changes it. If the commuter's words never clearly commit to a specific route letter (e.g. they stay vague, ask a question, or express pure uncertainty with no lean), answer "unclear".

Then compare that to the logged final choice given below, and say whether they are consistent.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"stated_route": "A" | "B" | "C" | "unclear", "consistent": true | false, "reasoning": "1 short sentence"}

If stated_route is "unclear", set consistent to true (nothing to contradict).

`;

function formatTranscript(transcript) {
  return transcript.map((t) => `${t.speaker === "advisor" ? "Advisor" : "Commuter"}: ${t.text}`).join("\n");
}

function parseJudgment(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && ["A", "B", "C", "unclear"].includes(parsed.stated_route) && typeof parsed.consistent === "boolean") {
      return {
        stated_route: parsed.stated_route,
        consistent: parsed.consistent,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : null,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

function normalize(r) {
  if (!r) return null;
  return r.startsWith("Route") ? r.slice(6) : r; // "Route B" -> "B"
}

async function judgeDecision(judgeModel, transcript, chosenRoute) {
  const context = `${formatTranscript(transcript)}\n\nLogged final choice: Route ${normalize(chosenRoute)}\n`;
  const raw = await callJudge(judgeModel, [{ role: "user", content: CONSISTENCY_RUBRIC + context }]);
  return parseJudgment(raw);
}

function parseArgs(argv) {
  const args = { file: null, judgeModel: "deepseek-r1:32b", outDir: path.join(REPO_ROOT, "results", "_metrics") };
  for (const arg of argv) {
    if (arg.startsWith("--judge-model=")) args.judgeModel = arg.slice("--judge-model=".length);
    else if (arg.startsWith("--out=")) args.outDir = arg.slice("--out=".length);
    else args.file = arg;
  }
  if (!args.file) {
    console.error("Usage: node scripts/simulated-population/judge-consistency.mjs <room.json> [--judge-model=deepseek-r1:32b] [--out=<dir>]");
    process.exit(1);
  }
  return args;
}

async function main() {
  const { file, judgeModel, outDir } = parseArgs(process.argv.slice(2));
  const exportData = JSON.parse(fs.readFileSync(file, "utf8"));
  const { room, round_logs: roundLogs } = exportData;

  console.log(`Checking consistency for room ${room.id} (advisor: ${room.persuader_model || room.agent_condition}) with judge model ${judgeModel}`);

  const perDecision = [];
  let done = 0;
  const rowsWithTranscript = roundLogs.filter((r) => r.switch_transcript || r.persuasion_transcript);

  for (const row of rowsWithTranscript) {
    // Prefer switch_transcript (closer to the final decision) if present,
    // matching the same "last word wins" logic as the regex detector.
    const transcript = row.switch_transcript || row.persuasion_transcript;
    const judgment = await judgeDecision(judgeModel, transcript, row.chosen_route).catch((err) => {
      console.error(`  [round ${row.round}] judge call failed:`, err.message);
      return null;
    });
    done++;
    if (judgment) {
      perDecision.push({
        round: row.round,
        session_id: row.session_id,
        stated_route: judgment.stated_route,
        chosen_route: normalize(row.chosen_route),
        consistent: judgment.consistent,
        reasoning: judgment.reasoning,
      });
      console.log(`  [${done}/${rowsWithTranscript.length}] round ${row.round} -> stated=${judgment.stated_route} chosen=${normalize(row.chosen_route)} consistent=${judgment.consistent}`);
    } else {
      console.log(`  [${done}/${rowsWithTranscript.length}] round ${row.round} -> FAILED`);
    }
  }

  const checked = perDecision.filter((d) => d.stated_route !== "unclear");
  const inconsistent = checked.filter((d) => !d.consistent);

  const result = {
    room_id: room.id,
    persuader_model: room.persuader_model || null,
    agent_condition: room.agent_condition,
    judge_model: judgeModel,
    judged_at: new Date().toISOString(),
    counts: {
      totalDecisions: roundLogs.length,
      totalJudged: perDecision.length,
      totalFailed: rowsWithTranscript.length - perDecision.length,
      checkedClearIntent: checked.length,
      unclearIntent: perDecision.length - checked.length,
      inconsistent: inconsistent.length,
    },
    inconsistencyRatePct: checked.length ? Math.round((inconsistent.length / checked.length) * 10000) / 100 : null,
    perDecision,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${room.id}-consistency-scores.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\n${room.id}: ${inconsistent.length}/${checked.length} inconsistent (${result.inconsistencyRatePct}%), ${result.counts.unclearIntent} unclear -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
