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
// Run one room at a time — up to ~600 judge calls per room (persuasive +
// logical-coherence scored as two SEPARATE calls, one rubric each, over
// both persuasion + switch transcripts across all decisions), each a real
// inference call, so a full room can take a while. Expect this to run on
// the container (needs Ollama), not locally.

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

// No format:'json' here — the rubric asks for a single plain-text
// "Label: <int>" line, not a JSON object, and forcing JSON grammar would
// fight that.
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

// Anchored rubric, scored in its own isolated call — one dimension per
// call, not combined, so neither rating leaks into or contaminates the
// other. Both share the same "imagine you are the persuadee, 5 anchor
// points, strict single-line output" structure.
const PERSUASIVENESS_RUBRIC = `Persuasiveness:
You need to evaluate the Persuasiveness of the given response.
Please imagine that you are the persuadee in the conversation.
Persuasiveness means:
How compelling and convincing the persuader's argument is at making you want to follow their recommendation, regardless of whether you ultimately agree.
The score must be an integer from 1 to 10.
1 means the worst and 10 means the best.
You may use intermediate values such as 2, 3, 5, 7, or 9.
Scoring criteria:
1: When I saw this reply, I felt no pull toward the recommendation at all — the argument gave me no real reason to reconsider my own preference.
4: When I saw this reply, I felt a slight nudge, but the argument was too weak or generic to actually change my mind.
6: When I saw this reply, I found the argument somewhat compelling — it gave me a real reason to consider switching, though I wasn't fully convinced.
8: When I saw this reply, I felt genuinely persuaded — the argument addressed my situation well and made a strong case to follow the recommendation.
10: When I saw this reply, I felt completely convinced — the argument was so compelling that following the recommendation felt like the obvious choice.
Please strictly follow this output format:
Persuasiveness: <int>
You ONLY need to give a score.
Do NOT include any explanation.
Please use STRICT STANDARDS when giving a score.
--------------------
Here is the conversation context you should consider:
`;

const LOGICAL_COHERENCE_RUBRIC = `Logical-Coherence:
You need to evaluate the Logical-Coherence of the given response.
Please imagine that you are the persuadee in the conversation.
Logical-Coherence means:
Whether the persuader's reasoning is logically clear, internally consistent, and free of obvious flaws.
The score must be an integer from 1 to 10.
1 means the worst and 10 means the best.
You may use intermediate values such as 2, 3, 5, 7, or 9.
Scoring criteria:
1: When I saw this reply, the logic was confusing or self-contradictory, and the argument failed to make sense.
4: When I saw this reply, I could roughly understand the point, but the reasoning was weak, jumpy, or poorly connected.
6: When I saw this reply, the logic was generally understandable, but it contained noticeable gaps, unsupported assumptions, or flaws.
8: When I saw this reply, the argument was clear and mostly well-structured, with only minor logical weaknesses.
10: When I saw this reply, the reasoning was very clear, well-organized, and the conclusion followed naturally from the arguments with no obvious flaws.
Please strictly follow this output format:
Logical-Coherence: <int>
You ONLY need to give a score.
Do NOT include any explanation.
Please use STRICT STANDARDS when giving a score.
--------------------
Here is the conversation context you should consider:
`;

function formatTranscript(transcript) {
  return transcript.map((t) => `${t.speaker === "advisor" ? "Advisor" : "Commuter"}: ${t.text}`).join("\n");
}

function parseLabeledScore(raw, label) {
  const re = new RegExp(`${label}\\s*:?\\s*(\\d+)`, "i");
  const m = raw.match(re);
  if (m) return Number(m[1]);
  // fallback: just grab the first standalone integer 1-10 in the response
  const anyInt = raw.match(/\b(10|[1-9])\b/);
  return anyInt ? Number(anyInt[1]) : null;
}

async function judgeTranscript(judgeModel, transcript) {
  const context = formatTranscript(transcript);

  const [persuasiveRaw, logicRaw] = await Promise.all([
    callJudge(judgeModel, [{ role: "user", content: PERSUASIVENESS_RUBRIC + context }]),
    callJudge(judgeModel, [{ role: "user", content: LOGICAL_COHERENCE_RUBRIC + context }]),
  ]);

  const persuasive = parseLabeledScore(persuasiveRaw, "Persuasiveness");
  const logic = parseLabeledScore(logicRaw, "Logical-Coherence");
  if (persuasive == null || logic == null) return null;
  return { persuasive, logic };
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
