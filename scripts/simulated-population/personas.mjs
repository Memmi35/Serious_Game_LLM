// 50 simulated-population personas (was 30) for Step 1 of the persuasion
// roadmap (see migrations/02_add_simulation_agents.sql for the persisted
// shape). Population size increased for a supervisor-requested "more, and
// more varied" population; lib/scenarios.ts's route capacities are scaled
// by the same 50/30 factor so per-agent congestion pressure stays
// comparable to prior 30-agent rooms.
//
// Trait ranges below are hand-picked PLACEHOLDERS, not real calibration —
// the roadmap calls for personas "calibrated from pilot human data", which
// doesn't exist yet. Replace SAMPLE_BOUNDS (and the named archetypes) once
// pilot data is available.

// Seeded PRNG (mulberry32) so a run is reproducible given the same seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260709;
const rng = mulberry32(SEED);

function uniform(min, max) {
  return min + rng() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Fisher-Yates, using the same seeded rng so the assignment stays
// reproducible given SEED.
function shuffle(arr, rngFn) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rngFn() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Trait bounds used both by the named archetypes (as anchors) and by the
// randomly-sampled fill personas. Units:
//   - riskAversion multiplies avg(flow/capacity) along the route (~0.2-1.5)
//   - delaySensitivity multiplies predicted_time directly (minutes, ~3-30)
//   - routeStickiness is an additive utility bonus for repeating last choice
//   - softmaxTemperature: low = decisive/peaked, high = exploratory/noisy
const SAMPLE_BOUNDS = {
  riskAversion: [0, 12],
  delaySensitivity: [0.5, 1.5],
  trustInAdvice: [0, 1], // unused in baseline (no advisor yet)
  decisionLatencyMean: [3, 25], // seconds
  decisionLatencySigma: [0.2, 0.7], // lognormal sigma, log-space
  routeStickiness: [0, 8],
  softmaxTemperature: [0.5, 6],
};

const COMMUTE_HABITS = [
  "risk_averse",
  "time_optimizer",
  "habitual",
  "explorer",
  "congestion_averse",
  "indifferent",
  "balanced",
];

// --- narrative grounding (for the LLM prompt engine, decide-llm.mjs) ---
//
// Segments are Anable, J. (2005) "'Complacent Car Addicts' or 'Aspiring
// Environmentalists'? Identifying travel behaviour segments using attitude
// theory", Transport Policy 12(1) — a widely-cited UK commuter attitude
// segmentation. The paper doesn't use our specific trait variables, so the
// 4-number `anchor` below is OUR interpretation of each segment's
// qualitative description translated onto [riskAversion, trustInAdvice,
// routeStickiness, softmaxTemperature] (each normalized 0-1 against
// SAMPLE_BOUNDS), used only to nearest-neighbor-match a persona to the
// closest-fitting segment for narrative flavor. Treat it as a reasonable
// heuristic mapping, not a value taken directly from the paper.
const SEGMENTS = [
  {
    name: "Malcontented Motorist",
    anchor: [0.7, 0.6, 0.3, 0.4],
    blurb:
      "You drive this route because you have to, not because you enjoy it. Traffic genuinely stresses you out, and you'd switch routes in a heartbeat if you were confident it would actually help.",
  },
  {
    name: "Complacent Car Addict",
    anchor: [0.3, 0.3, 0.8, 0.6],
    blurb:
      "You don't think hard about this commute — you drive the same way most days because it's easy, not because you've calculated it's best. Changing your route takes real effort to justify.",
  },
  {
    name: "Aspiring Environmentalist",
    anchor: [0.6, 0.8, 0.2, 0.3],
    blurb:
      "You like making the smart, efficient choice and feel a little bad about contributing to congestion. You pay attention to good advice and information when it's given to you straight.",
  },
  {
    name: "Die Hard Driver",
    anchor: [0.1, 0.2, 0.4, 0.3],
    blurb:
      "You know this network well and trust your own judgment over anyone else's. Speed and control matter to you; you're skeptical of advice that tells you what you'd have figured out yourself.",
  },
  {
    name: "Car-less Crusader",
    anchor: [0.5, 0.7, 0.1, 0.2],
    blurb:
      "You're analytical about this commute — you actively compare options and adjust readily when a better one shows up. You're not sentimental about any particular route.",
  },
  {
    name: "Reluctant Rider",
    anchor: [0.9, 0.7, 0.5, 0.5],
    blurb:
      "Traffic makes you anxious, and you'd rather have reassurance than gamble. You lean on trusted advice when it's available because you'd rather not be the one who guessed wrong.",
  },
];


// NHTS (National Household Travel Survey, FHWA)-informed grounding: average
// US one-way commute is ~26 minutes, departures cluster 6:30-9:00am, and
// roughly 15-20% of commutes involve dropping someone off en route. Names/
// occupations/stakes below aren't from the survey itself (NHTS doesn't
// publish those) — only the shape (a plausible weekday commute with a
// deadline, sometimes involving a dependent) is grounded in it.
const FIRST_NAMES = [
  "Maria", "James", "Aisha", "Wei", "Diego", "Emma", "Kwame", "Priya",
  "Liam", "Fatima", "Noah", "Sofia", "Ravi", "Chloe", "Omar", "Grace",
  "Lucas", "Amara", "Ethan", "Nadia", "Mateo", "Ingrid", "Samuel", "Yuki",
  "Isabella", "Daniel", "Zainab", "Henry", "Layla", "Marcus",
  // Added for the 30 -> 50 agent population-size increase, keeping the
  // without-replacement, no-duplicate-name assignment valid at 50.
  "Anaya", "Bruno", "Chiamaka", "Dmitri", "Elif", "Farid", "Giulia", "Hiro",
  "Ines", "Jonas", "Kaya", "Luz", "Mei", "Nasrin", "Oleg", "Paloma",
  "Quinn", "Rania", "Santiago", "Tanvir",
];

const OCCUPATIONS_AND_STAKES = [
  { occupation: "nurse", stake: "your shift starts at 7:00am and being late means a colleague is stuck covering for you" },
  { occupation: "teacher", stake: "you need to be in your classroom before the first bell" },
  { occupation: "software engineer", stake: "you have a standing 9am stand-up meeting" },
  { occupation: "retail store manager", stake: "you're the one who has to unlock the store" },
  { occupation: "accountant", stake: "it's close to filing deadline and every minute at your desk counts" },
  { occupation: "delivery driver", stake: "your whole day's route schedule cascades if you start late" },
  { occupation: "warehouse worker", stake: "clocking in late means a docked shift" },
  { occupation: "graphic designer", stake: "you have flexible hours, so today's timing is really just your own preference" },
  { occupation: "electrician", stake: "you're meeting a client at a job site at a fixed time" },
  { occupation: "parent working part-time", stake: "you need to drop your kid at school before doubling back to work" },
  { occupation: "consultant", stake: "you have back-to-back client calls starting mid-morning" },
  { occupation: "restaurant cook", stake: "prep has to be done before the doors open for lunch" },
  { occupation: "college student with a morning class", stake: "your professor marks you late after the first five minutes" },
  { occupation: "physical therapist", stake: "your first patient appointment is booked tight" },
  { occupation: "bus dispatcher", stake: "ironically, you have to be on time to send other people out on time" },
];

// name: pre-assigned from a shuffled, no-replacement draw (see PERSONAS
// below) — two different agents having the identical first name was
// confusing in transcripts/logs with no behavioral upside. Occupations are
// still drawn with replacement: duplicates there are realistic (multiple
// nurses can plausibly share a commute network) and there are only 15 of
// them for 30 agents, so without-replacement isn't even possible twice over.
function buildNarrative(name, rngFn) {
  const { occupation, stake } = OCCUPATIONS_AND_STAKES[Math.floor(rngFn() * OCCUPATIONS_AND_STAKES.length)];
  return { name, occupation, stake };
}

// Named, interpretable archetypes to seed the population and make later
// qualitative review easier. These are now derived DIRECTLY from SEGMENTS'
// own anchor vectors above (riskAversion, trustInAdvice, routeStickiness,
// softmaxTemperature, denormalized against SAMPLE_BOUNDS) instead of being a
// separately hand-invented set -- so the named archetypes are literally
// Anable (2005)'s 6 segments, not just narratively matched to them after
// the fact. This replaced an earlier set of 12 ad hoc archetypes (6 hand-
// picked + 6 added for the population-size increase) that had no direct
// tie to the segmentation literature at all -- see git history if that
// version is ever needed for comparison.
//
// The paper's segmentation doesn't cover delaySensitivity, decisionLatency-
// Mean/Sigma, or commuteHabit, so those four are still our own placeholder
// judgment calls, chosen to match each segment's qualitative blurb (e.g.
// "Die Hard Driver... speed and control matter" -> high delaySensitivity,
// fast decisionLatencyMean).
// The 4 traits Anable (2005) doesn't cover, picked per-segment to match
// each one's qualitative blurb above (not derived from the paper).
const ARCHETYPE_EXTRA_TRAITS = {
  "Malcontented Motorist": { delaySensitivity: 1.1, decisionLatencyMean: 12, decisionLatencySigma: 0.4, commuteHabit: "congestion_averse" }, // stressed by traffic, would switch given confidence
  "Complacent Car Addict": { delaySensitivity: 0.7, decisionLatencyMean: 6, decisionLatencySigma: 0.3, commuteHabit: "habitual" }, // doesn't optimize, low-effort default choice
  "Aspiring Environmentalist": { delaySensitivity: 1.3, decisionLatencyMean: 10, decisionLatencySigma: 0.3, commuteHabit: "balanced" }, // efficiency-focused, attentive to good advice
  "Die Hard Driver": { delaySensitivity: 1.4, decisionLatencyMean: 5, decisionLatencySigma: 0.2, commuteHabit: "time_optimizer" }, // speed and control matter
  "Car-less Crusader": { delaySensitivity: 1.1, decisionLatencyMean: 6, decisionLatencySigma: 0.2, commuteHabit: "explorer" }, // analytical, adjusts readily
  "Reluctant Rider": { delaySensitivity: 0.8, decisionLatencyMean: 18, decisionLatencySigma: 0.4, commuteHabit: "risk_averse" }, // anxious, deliberates, leans on trusted advice
};

const ARCHETYPES = SEGMENTS.map((seg, i) => {
  const [riskNorm, trustNorm, stickyNorm, tempNorm] = seg.anchor;
  const denorm = (norm, [low, high]) => Math.round((low + norm * (high - low)) * 100) / 100;
  return {
    id: `archetype_${String(i + 1).padStart(2, "0")}`,
    label: seg.name,
    riskAversion: denorm(riskNorm, SAMPLE_BOUNDS.riskAversion),
    trustInAdvice: denorm(trustNorm, SAMPLE_BOUNDS.trustInAdvice),
    routeStickiness: denorm(stickyNorm, SAMPLE_BOUNDS.routeStickiness),
    softmaxTemperature: denorm(tempNorm, SAMPLE_BOUNDS.softmaxTemperature),
    // Placeholder judgment calls, not from the paper -- see comment above.
    ...ARCHETYPE_EXTRA_TRAITS[seg.name],
    _sampledSegment: seg.name,
  };
});

// Real population proportions from Anable (2005), Table 2 (p. 69) --
// verified directly against the primary source text (not a secondary
// citation). Supersedes an earlier "equitable trust" stratification that
// forced trustInAdvice into a balanced 17/16/17 low/mid/high split per a
// supervisor request: that conflicts with sampling to match these real
// segment proportions, since trust is anchored per-segment in SEGMENTS
// above and the two largest real-world segments (Complacent Car Addicts
// 26%, Die Hard Drivers 19% -- 45% combined) are both low-trust. Decided
// (explicit confirmation) to prioritize "this population matches a real,
// published commuter segmentation" for the paper over the equitable-trust
// request, since the former is now a verified, citable claim and the
// latter was an internal request with no literature backing.
const SEGMENT_SHARE_PCT = {
  "Malcontented Motorist": 30,
  "Complacent Car Addict": 26,
  "Die Hard Driver": 19,
  "Aspiring Environmentalist": 18,
  "Car-less Crusader": 4,
  "Reluctant Rider": 3,
};

// Largest-remainder rounding of SEGMENT_SHARE_PCT against totalAgents, so
// the per-segment quota always sums exactly to totalAgents (e.g. 50 ->
// 15/13/9/10/2/1 in SEGMENTS' own order) regardless of population size.
function segmentQuota(totalAgents) {
  const exact = SEGMENTS.map((s) => (SEGMENT_SHARE_PCT[s.name] / 100) * totalAgents);
  const floors = exact.map(Math.floor);
  const remaining = totalAgents - floors.reduce((a, b) => a + b, 0);
  const remainders = exact.map((v, i) => ({ i, frac: v - floors[i] }));
  remainders.sort((a, b) => b.frac - a.frac);
  const quota = [...floors];
  for (let k = 0; k < remaining; k++) quota[remainders[k].i] += 1;
  const result = {};
  SEGMENTS.forEach((s, i) => (result[s.name] = quota[i]));
  return result;
}

// +/-15% jitter (of each trait's own bound range) around a segment's own
// anchor/extra-trait value, so within-segment variants are recognizably
// that segment's type (matching its real-world profile) rather than
// independently random points later nearest-matched by coincidence.
const JITTER = 0.15;

function jitterNorm(anchorNorm, rngFn) {
  return Math.min(1, Math.max(0, anchorNorm + (rngFn() * 2 - 1) * JITTER));
}

function jitterAbs(value, [low, high], rngFn) {
  const range = high - low;
  return Math.round(Math.min(high, Math.max(low, value + (rngFn() * 2 - 1) * JITTER * range)) * 100) / 100;
}

function sampleSegmentVariant(index, seg) {
  const [riskNorm, trustNorm, stickyNorm, tempNorm] = seg.anchor;
  const denorm = (norm, [low, high]) => Math.round((low + norm * (high - low)) * 100) / 100;
  const extra = ARCHETYPE_EXTRA_TRAITS[seg.name];
  return {
    id: `config_${String(index).padStart(2, "0")}`,
    label: `Sim Agent ${index}`,
    riskAversion: denorm(jitterNorm(riskNorm, rng), SAMPLE_BOUNDS.riskAversion),
    trustInAdvice: denorm(jitterNorm(trustNorm, rng), SAMPLE_BOUNDS.trustInAdvice),
    routeStickiness: denorm(jitterNorm(stickyNorm, rng), SAMPLE_BOUNDS.routeStickiness),
    softmaxTemperature: denorm(jitterNorm(tempNorm, rng), SAMPLE_BOUNDS.softmaxTemperature),
    delaySensitivity: jitterAbs(extra.delaySensitivity, SAMPLE_BOUNDS.delaySensitivity, rng),
    decisionLatencyMean: jitterAbs(extra.decisionLatencyMean, SAMPLE_BOUNDS.decisionLatencyMean, rng),
    decisionLatencySigma: jitterAbs(extra.decisionLatencySigma, SAMPLE_BOUNDS.decisionLatencySigma, rng),
    commuteHabit: pick(COMMUTE_HABITS),
    // Tagged with the segment it was actually sampled for, rather than
    // left to nearestSegment() to re-derive later -- jitter can push a
    // variant's trait vector closer to a NEIGHBORING segment's anchor by
    // chance (e.g. Aspiring Environmentalist and Car-less Crusader sit
    // close together in trait space), which would otherwise silently
    // drift the reported segment counts away from the real Anable (2005)
    // quota and mismatch the persona's own narrative blurb against the
    // segment it was actually drawn to represent.
    _sampledSegment: seg.name,
  };
}

const TOTAL_AGENTS = 50; // was 30 -- see lib/scenarios.ts for the matching 50/30 capacity scaling
const quota = segmentQuota(TOTAL_AGENTS);
let variantIndex = ARCHETYPES.length + 1;
const sampled = SEGMENTS.flatMap((seg) => {
  const variantCount = quota[seg.name] - 1; // -1: the archetype itself already covers one slot
  return Array.from({ length: Math.max(0, variantCount) }, () => sampleSegmentVariant(variantIndex++, seg));
});
if (ARCHETYPES.length + sampled.length !== TOTAL_AGENTS) {
  throw new Error(`Segment quota mismatch: ${ARCHETYPES.length + sampled.length} personas built, expected ${TOTAL_AGENTS}`);
}

// Without-replacement name assignment (modulo guard only matters if
// TOTAL_AGENTS ever exceeds FIRST_NAMES.length; today they're equal).
const shuffledNames = shuffle(FIRST_NAMES, rng);

export const PERSONAS = [...ARCHETYPES, ...sampled].map((p, i) => {
  const { name, occupation, stake } = buildNarrative(shuffledNames[i % shuffledNames.length], rng);
  // Use the segment this persona was actually sampled/quota-assigned for
  // (_sampledSegment), not nearestSegment()'s independent re-derivation --
  // see sampleSegmentVariant()'s comment for why those can disagree.
  const seg = SEGMENTS.find((s) => s.name === p._sampledSegment);
  const { _sampledSegment, ...rest } = p;
  return {
    ...rest,
    agentIndex: i + 1,
    llmBackend: "rule-based-v1",
    name,
    occupation,
    stake,
    segment: seg.name,
    segmentBlurb: seg.blurb,
  };
});
