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

function normalize(value, [low, high]) {
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

function nearestSegment(persona) {
  const vec = [
    normalize(persona.riskAversion, SAMPLE_BOUNDS.riskAversion),
    normalize(persona.trustInAdvice, SAMPLE_BOUNDS.trustInAdvice),
    normalize(persona.routeStickiness, SAMPLE_BOUNDS.routeStickiness),
    normalize(persona.softmaxTemperature, SAMPLE_BOUNDS.softmaxTemperature),
  ];
  let best = null;
  for (const seg of SEGMENTS) {
    const dist = Math.sqrt(vec.reduce((sum, v, i) => sum + (v - seg.anchor[i]) ** 2, 0));
    if (!best || dist < best.dist) best = { seg, dist };
  }
  return best.seg;
}

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
  };
});

function samplePersona(index) {
  return {
    id: `config_${String(index).padStart(2, "0")}`,
    label: `Sim Agent ${index}`,
    riskAversion: uniform(...SAMPLE_BOUNDS.riskAversion),
    delaySensitivity: uniform(...SAMPLE_BOUNDS.delaySensitivity),
    trustInAdvice: uniform(...SAMPLE_BOUNDS.trustInAdvice),
    decisionLatencyMean: uniform(...SAMPLE_BOUNDS.decisionLatencyMean),
    decisionLatencySigma: uniform(...SAMPLE_BOUNDS.decisionLatencySigma),
    routeStickiness: uniform(...SAMPLE_BOUNDS.routeStickiness),
    softmaxTemperature: uniform(...SAMPLE_BOUNDS.softmaxTemperature),
    commuteHabit: pick(COMMUTE_HABITS),
  };
}

const TOTAL_AGENTS = 50; // was 30 -- see lib/scenarios.ts for the matching 50/30 capacity scaling
const fillCount = TOTAL_AGENTS - ARCHETYPES.length;
const sampled = Array.from({ length: fillCount }, (_, i) => samplePersona(i + ARCHETYPES.length + 1));

// Without-replacement name assignment (modulo guard only matters if
// TOTAL_AGENTS ever exceeds FIRST_NAMES.length; today they're equal).
const shuffledNames = shuffle(FIRST_NAMES, rng);

export const PERSONAS = [...ARCHETYPES, ...sampled].map((p, i) => {
  const { name, occupation, stake } = buildNarrative(shuffledNames[i % shuffledNames.length], rng);
  return {
    ...p,
    agentIndex: i + 1,
    llmBackend: "rule-based-v1",
    name,
    occupation,
    stake,
    segment: nearestSegment(p).name,
    segmentBlurb: nearestSegment(p).blurb,
  };
});
