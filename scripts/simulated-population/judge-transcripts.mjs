#!/usr/bin/env node
// Scores persuasion quality for one already-exported room, matching the
// proposal's "Persuasive"/"Logic" metrics (1-10 LLM-judge scales). The
// transcripts themselves come from the room's exported JSON offline (no
// live DB needed), but producing the actual scores requires a live call
// per transcript to the judge model via Ollama — that part can't be
// offline, judging requires inference.
//
// Success (did the final choice match the advisor's recommendation) is
// NOT judged here — it's already exact structured data
// (chosen_route/ai_recommended_route), more reliable than asking an LLM
// to infer alignment from prose. Avg_Turn is not computed at all: the
// current dialogue is a fixed 3-turn exchange, not adaptive-until-
// convinced, so there is no turn-of-persuasion to measure until Phase 3
// (RegConSuader) adds live, variable-length regulation.
//
// The judge prompt never reveals which model authored the advisor's
// messages, only the transcript content — deliberate blinding, though
// note this doesn't fully eliminate self-preference bias if the judge
// model is also one of the advisor models being compared (stylistic
// self-preference doesn't require knowing the source).
//
// Usage:
//   node scripts/simulated-population/judge-transcripts.mjs <room.json> [--judge-model=deepseek-r1:32b] [--out=<dir>]
//
// Run one room at a time — up to ~300 judge calls per room (persuasion +
// switch transcripts across all decisions), each a real inference call,
// so a full room can take a while. Expect this to run on the container
// (needs Ollama), not locally.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "8192", 10);
const TIMEOUT_MS = 90_000;

// Mirrors lib/agent/ollama.ts's stripThink()/stripCodeFence() — see that
// file for why. deepseek-r1:32b as judge needs both: it emits <think>
// blocks, and can wrap its JSON answer in a markdown fence even with
// format:'json' requested.
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

const JUDGE_SYSTEM_PROMPT = `You are an impartial judge scoring a persuasion dialogue from a traffic route-choice experiment. You are not told which AI system generated the advisor's messages, and should not try to guess — judge the content on its own merits only.

Score the advisor's performance in this exchange on two independent 1-10 integer scales:
- persuasive: how rhetorically effective and compelling the advisor's argument was, independent of whether the commuter ultimately agreed.
- logic: how logically coherent and well-grounded in the facts actually stated in the dialogue (times, capacities, distribution figures) the advisor's reasoning was. Penalize invented numbers, contradictions, or reasoning that doesn't follow.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"persuasive": <integer 1-10>, "logic": <integer 1-10>}`;

function formatTranscript(transcript) {
  return transcript.map((t) => `${t.speaker === "advisor" ? "Advisor" : "Commuter"}: ${t.text}`).join("\n");
}

function parseScore(raw) {
  try {
    const parsed = JSON.parse(raw);
    const p = Number(parsed.persuasive);
    const l = Number(parsed.logic);
    if (Number.isFinite(p) && Number.isFinite(l)) return { persuasive: p, logic: l };
  } catch {
    // fall through to regex fallback below
  }
  const m = raw.match(/persuasive["\s:]+(\d+)[\s\S]*?logic["\s:]+(\d+)/i);
  if (m) return { persuasive: Number(m[1]), logic: Number(m[2]) };
  return null;
}

async function judgeTranscript(judgeModel, transcript) {
  const raw = await callJudge(judgeModel, [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: formatTranscript(transcript) },
  ]);
  return parseScore(raw);
}

function parseArgs(argv) {
  const args = { file: null, judgeModel: "deepseek-r1:32b", outDir: path.join(REPO_ROOT, "results", "_metrics") };
  for (const arg of argv) {
    if (arg.startsWith("--judge-model=")) args.judgeModel = arg.slice("--judge-model=".length);
    else if (arg.startsWith("--out=")) args.outDir = arg.slice("--out=".length);
    else args.file = arg;
  }
  if (!args.file) {
    console.error("Usage: node scripts/simulated-population/judge-transcripts.mjs <room.json> [--judge-model=deepseek-r1:32b] [--out=<dir>]");
    process.exit(1);
  }
  return args;
}

function avg(nums) {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
}

async function main() {
  const { file, judgeModel, outDir } = parseArgs(process.argv.slice(2));
  const exportData = JSON.parse(fs.readFileSync(file, "utf8"));
  const { room, round_logs: roundLogs } = exportData;

  console.log(`Judging room ${room.id} (advisor: ${room.persuader_model || room.agent_condition}) with judge model ${judgeModel}`);

  const perDecision = [];
  let done = 0;
  const totalToJudge = roundLogs.reduce((n, r) => n + (r.persuasion_transcript ? 1 : 0) + (r.switch_transcript ? 1 : 0), 0);

  for (const row of roundLogs) {
    const entry = { round: row.round, session_id: row.session_id, initial: null, switch: null };

    if (row.persuasion_transcript) {
      entry.initial = await judgeTranscript(judgeModel, row.persuasion_transcript).catch((err) => {
        console.error(`  [round ${row.round}] initial judge call failed:`, err.message);
        return null;
      });
      done++;
      console.log(`  [${done}/${totalToJudge}] round ${row.round} initial -> ${entry.initial ? `persuasive=${entry.initial.persuasive} logic=${entry.initial.logic}` : "FAILED"}`);
    }

    if (row.switch_transcript) {
      entry.switch = await judgeTranscript(judgeModel, row.switch_transcript).catch((err) => {
        console.error(`  [round ${row.round}] switch judge call failed:`, err.message);
        return null;
      });
      done++;
      console.log(`  [${done}/${totalToJudge}] round ${row.round} switch -> ${entry.switch ? `persuasive=${entry.switch.persuasive} logic=${entry.switch.logic}` : "FAILED"}`);
    }

    perDecision.push(entry);
  }

  const initialScores = perDecision.map((e) => e.initial).filter(Boolean);
  const switchScores = perDecision.map((e) => e.switch).filter(Boolean);
  const allScores = [...initialScores, ...switchScores];

  const result = {
    room_id: room.id,
    persuader_model: room.persuader_model || null,
    judge_model: judgeModel,
    judged_at: new Date().toISOString(),
    counts: { totalToJudge, judged: allScores.length, failed: totalToJudge - allScores.length },
    overall: { persuasive: avg(allScores.map((s) => s.persuasive)), logic: avg(allScores.map((s) => s.logic)) },
    initialPhase: { persuasive: avg(initialScores.map((s) => s.persuasive)), logic: avg(initialScores.map((s) => s.logic)) },
    switchPhase: { persuasive: avg(switchScores.map((s) => s.persuasive)), logic: avg(switchScores.map((s) => s.logic)) },
    perDecision,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${room.id}-judge-scores.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\nRoom ${room.id} — overall: persuasive=${result.overall.persuasive} logic=${result.overall.logic} (${result.counts.judged}/${result.counts.totalToJudge} judged, ${result.counts.failed} failed)`);
  console.log(`Saved -> ${outPath}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
