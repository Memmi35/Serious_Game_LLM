#!/usr/bin/env node
// Checks whether a decision's stated reason (choice_reason) actually
// matches the route it was reasoning ABOUT -- choice_reason is written
// during Phase A (decideFinalChoiceAfterPersuasion, the opening-pitch
// decision, logged as initial_choice), while chosen_route/final_choice
// reflects whatever happens AFTER the separate Phase B switch decision
// (decideSwitchLLM, with its own switch_reason field). So the correct
// comparison is choice_reason vs initial_choice, NOT vs chosen_route --
// comparing against chosen_route conflates "the reasoning doesn't match
// the decision it was for" with "the player switched afterward", which
// is a completely different (and totally legitimate) thing. An earlier
// version of this script made exactly that mistake and reported a false
// ~50-90% "incoherence rate" that was actually just the switch rate in
// disguise (verified: 26/27 "incoherent" cases in one room were simply
// switched decisions, only 1 was a genuine same-phase mismatch).
//
// Rule-based, offline -- no Ollama call needed, this is purely a text/
// structured-data check on data that's already exported.
//
// Usage:
//   node scripts/simulated-population/check-reason-coherence.mjs <room.json> [--out=<dir>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Phrases whose presence signals the agent BELIEVES it is following the
// advisor's recommendation -- if the logged route doesn't match, the
// reason and the decision contradict each other. Deliberately broader
// than just "trust" (also catches "follow"/"adopt"/"align with"/
// "support" + advisor/AI/recommendation language), since the manual
// examples showed several phrasings beyond "trust".
const COMPLIANCE_INTENT = /\b(trust(?:ing|ed)?|follow(?:ing|ed)?|adopt(?:ing|ed)?|align(?:ing|ed)?\s*with|support(?:ing|ed)?)\b.{0,40}\b(ai|advisor|advice|recommendation|suggestion|system-optimal|optimal split)\b/i;

function normalize(r) {
  if (!r) return null;
  return r.startsWith("Route") ? r : `Route ${r}`;
}

function checkRoom(exportData) {
  const { room, round_logs: roundLogs } = exportData;
  let totalWithRec = 0;
  let rawCompliant = 0; // compliance measured on chosen_route (final), the official metric
  let complianceIntentTotal = 0;
  let complianceIntentIncoherent = 0; // reason vs the phase-A route it was actually about (initial_choice)
  const incoherentDecisions = [];

  for (const row of roundLogs) {
    const rec = normalize(row.ai_recommended_route);
    if (!rec) continue;
    totalWithRec++;
    const compliant = row.chosen_route === rec;
    if (compliant) rawCompliant++;

    const reason = row.choice_reason || "";
    const initialChoice = normalize(row.initial_choice);
    if (COMPLIANCE_INTENT.test(reason)) {
      complianceIntentTotal++;
      // Compare against initial_choice (what Phase A actually decided,
      // which is what choice_reason was written about) -- NOT
      // chosen_route, which may reflect a later Phase B switch that
      // choice_reason was never updated to describe.
      const phaseACoherent = initialChoice === rec;
      if (!phaseACoherent) {
        complianceIntentIncoherent++;
        incoherentDecisions.push({
          round: row.round,
          session_id: row.session_id,
          recommended: rec,
          initial_choice: row.initial_choice,
          final_choice: row.final_choice,
          switched: row.initial_choice !== row.final_choice,
          reason,
        });
      }
    }
  }

  const rawCompliancePct = totalWithRec ? Math.round((rawCompliant / totalWithRec) * 10000) / 100 : null;
  // Corrected compliance: exclude decisions where the Phase A reasoning
  // genuinely contradicts the Phase A route (a real coherence problem),
  // from both numerator and denominator of the FINAL compliance metric --
  // these are the only "broken signal" rows now, not switches.
  const correctedDenominator = totalWithRec - complianceIntentIncoherent;
  const correctedCompliancePct = correctedDenominator
    ? Math.round((rawCompliant / correctedDenominator) * 10000) / 100
    : null;

  return {
    room_id: room.id,
    persuader_model: room.persuader_model || null,
    agent_condition: room.agent_condition,
    counts: {
      totalDecisionsWithRecommendation: totalWithRec,
      rawCompliant,
      complianceIntentReasons: complianceIntentTotal,
      complianceIntentButIncoherent: complianceIntentIncoherent,
    },
    rawCompliancePct,
    correctedCompliancePct,
    incoherenceRateAmongComplianceIntentPct: complianceIntentTotal
      ? Math.round((complianceIntentIncoherent / complianceIntentTotal) * 10000) / 100
      : null,
    incoherentDecisions,
  };
}

function parseArgs(argv) {
  const args = { file: null, outDir: path.join(REPO_ROOT, "results", "_metrics") };
  for (const arg of argv) {
    if (arg.startsWith("--out=")) args.outDir = arg.slice("--out=".length);
    else args.file = arg;
  }
  if (!args.file) {
    console.error("Usage: node scripts/simulated-population/check-reason-coherence.mjs <room.json> [--out=<dir>]");
    process.exit(1);
  }
  return args;
}

function main() {
  const { file, outDir } = parseArgs(process.argv.slice(2));
  const exportData = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = checkRoom(exportData);

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${result.room_id}-reason-coherence.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(
    `${result.room_id} (${result.persuader_model || result.agent_condition}): ` +
      `raw compliance ${result.rawCompliancePct}%, corrected compliance ${result.correctedCompliancePct}% ` +
      `(excluded ${result.counts.complianceIntentButIncoherent}/${result.counts.totalDecisionsWithRecommendation} incoherent decisions, ` +
      `${result.incoherenceRateAmongComplianceIntentPct}% of the ${result.counts.complianceIntentReasons} compliance-intent reasons) -> ${outPath}`
  );
}

main();
