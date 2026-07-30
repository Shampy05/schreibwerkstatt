// CEFR level — the *ceiling*: how demanding a task should be and how strictly
// the analysis should judge. Self-reported, because CEFR is assessed against far
// more than written accuracy and an app scoring its own learner on its own
// errors would be marking its own homework.
//
// Distinct from the Processability stage (stage.js), which is the *floor*:
// measured from your own output, and about which grammar is learnable now.
// Level says how hard the task is; stage says which structures may be targeted.

export const CEFR_LEVELS = ['A2', 'B1', 'B2', 'C1']
export const DEFAULT_LEVEL = 'B1'

const DESCRIPTORS = {
  A2: {
    label: 'A2 — elementary',
    sentences: '5–8',
    task: 'Concrete everyday situations: short messages, simple descriptions, straightforward requests. Present and Perfekt. Simple connectors (und, aber, weil, dann).',
    analysis:
      'Report errors that break a core rule or block comprehension. Do not flag register or stylistic subtleties. Flag WORTW only when the phrasing is genuinely confusing.',
  },
  B1: {
    label: 'B1 — intermediate',
    sentences: '5–10',
    task: 'Familiar topics handled with some independence: narrating events, giving and justifying opinions, describing experiences and plans. Subordinate clauses, Konjunktiv II for politeness and hypotheticals, past-tense narration.',
    analysis:
      'Report all grammatical errors. Flag WORTW only where the phrasing is clearly non-native, not merely plain.',
  },
  B2: {
    label: 'B2 — upper intermediate',
    sentences: '8–12',
    task: 'Everyday topics handled with some abstraction: argument and counter-argument, weighing options, retelling what someone else claimed, complaints and negotiations with a clear line of reasoning. Passive, Genitive, nuanced connectors (obwohl, dennoch, sofern), reported speech.',
    analysis:
      'Report all grammatical errors, and additionally flag register mismatches and unidiomatic-but-grammatical phrasing (WORTW) — at this level clumsiness is worth naming.',
  },
  C1: {
    label: 'C1 — advanced',
    sentences: '10–15',
    task: 'Complex subject matter with controlled register, still rooted in lived situations: structured argument, implication and nuance, precise hedging, irony where it fits. Nominalization, extended attributes, subtle connectors, deliberate information structure.',
    analysis:
      'Hold the text to a near-native standard. Report grammatical errors, and flag register slips, awkward information structure, and phrasing a native writer would not choose, even when it is fully grammatical.',
  },
}

export function normalizeLevel(level) {
  return CEFR_LEVELS.includes(level) ? level : DEFAULT_LEVEL
}

export function levelDescriptor(level) {
  return DESCRIPTORS[normalizeLevel(level)]
}

// The level being worked toward. C1 is the top of the ladder here, so it
// reaches for itself rather than inventing a C2 the descriptors don't cover.
export function nextLevel(level) {
  const i = CEFR_LEVELS.indexOf(normalizeLevel(level))
  return CEFR_LEVELS[Math.min(i + 1, CEFR_LEVELS.length - 1)]
}

// Prompt fragment for the task generator. Tasks are pitched at the current
// level but told to reach toward the next one — a task you can already do
// comfortably produces no errors and teaches nothing.
export function taskLevelBlock(level) {
  const cur = levelDescriptor(level)
  const up = nextLevel(level)
  const reach =
    up === normalizeLevel(level)
      ? 'This is the top level here — keep the demand high and the register controlled.'
      : `Reach toward ${up}: the task should be completable at ${normalizeLevel(level)} but stretch slightly into ${up} territory (${levelDescriptor(up).task})`
  return `Learner level: ${cur.label}.
Pitch the task at: ${cur.task}
Length: completable in ${cur.sentences} sentences.
${reach}`
}

// Prompt fragment for the analysis engine.
export function analysisLevelBlock(level) {
  const cur = levelDescriptor(level)
  return `Learner level: ${cur.label}. ${cur.analysis}`
}
