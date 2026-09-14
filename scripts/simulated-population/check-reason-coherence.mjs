#!/usr/bin/env node
// Checks whether a decision's stated reason (choice_reason) actually
// matches the route that was logged (chosen_route) -- found via manual
// inspection (2026-09) that a large fraction of "compliance-intent"
// reasons ("Trusting AI advice...") are logged against a DIFFERENT route
// than the one recommended, with no acknowledgment of the mismatch in the
// text itself. That's a generation-coherence artifact in
// decideFinalChoiceAfterPersuasion's single-call {route, reason} output,
// not genuine persuasion failure or reasoned disagreement -- confirmed by
// reading the actual reason text (it never explains *why* it's deviating,
// it just restates "trusting the advisor" while picking something else).
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
  let rawCompliant = 0;
  let complianceIntentTotal = 0;
  let complianceIntentIncoherent = 0;
  const incoherentDecisions = [];

  for (const row of roundLogs) {
    const rec = normalize(row.ai_recommended_route);
    if (!rec) continue;
    totalWithRec++;
    const compliant = row.chosen_route === rec;
    if (compliant) rawCompliant++;

    const reason = row.choice_reason || "";
    if (COMPLIANCE_INTENT.test(reason)) {
      complianceIntentTotal++;
      if (!compliant) {
        complianceIntentIncoherent++;
        incoherentDecisions.push({
          round: row.round,
          session_id: row.session_id,
          recommended: rec,
          chosen: row.chosen_route,
          reason,
        });
      }
    }
  }

  const rawCompliancePct = totalWithRec ? Math.round((rawCompliant / totalWithRec) * 10000) / 100 : null;
  // Corrected compliance: exclude incoherent decisions from BOTH
  // numerator and denominator -- they're neither confirmed compliant nor
  // confirmed non-compliant, the signal is just broken for these rows.
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
