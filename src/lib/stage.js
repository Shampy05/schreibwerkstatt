// Processability stage — the *floor*: which German structures are learnable
// right now, measured from your own output rather than self-reported.
//
// Pienemann's Processability Theory, built on the ZISA study of German word
// order, holds that syntax is acquired in a fixed sequence, and the Teachability
// Hypothesis adds that instruction only sticks at the current stage + 1. So the
// app refuses to make verb-final-in-subordinate-clauses an active target while
// V2 after a fronted adverbial is still unstable.
//
// HONEST LIMIT: the ledger records errors, not correct productions, so we can
// only observe instability — never emergence. A stage that has gone quiet may
// mean you've acquired it, or may mean you've been avoiding it. Generated tasks
// obligate their target structures precisely to narrow that gap, but the
// diagnosis is a heuristic and is labelled as one in the UI.

import { TAXONOMY, patternFor } from './taxonomy'

// The ZISA/Processability sequence for German. Stages 3–5 are the ones the
// taxonomy actually tags; 1, 2 and 6 are here so the sequence reads whole.
export const STAGE_NAMES = {
  1: 'Words and formulaic chunks',
  2: 'Canonical order (SVO)',
  3: 'Adverb fronting; separable-verb split',
  4: 'Verb-second (inversion after a fronted constituent)',
  5: 'Verb-final in subordinate clauses',
  6: 'Nested subordination',
}

export const STAGED_CODES = TAXONOMY.filter((p) => p.stage != null).map((p) => p.code)

function cutoffDate(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// The learner's working stage: the LOWEST stage still producing recent errors.
// Errors at a higher stage while a lower one is unstable are noise — the lower
// structure has to settle first.
//
// Returns { stage, byStage, evidence }. `stage` is null when no stage-bound
// error has been seen in the window, which means "not enough evidence" — the
// caller must then apply no gate at all rather than assuming stage 1.
export function diagnoseStage(ledger, { now = new Date(), windowDays = 28 } = {}) {
  const cutoff = cutoffDate(now, windowDays)
  const byStage = {}
  let evidence = 0

  for (const entry of Object.values(ledger || {})) {
    const pattern = patternFor(entry.code)
    if (!pattern || pattern.stage == null) continue
    const recent = (entry.occurrences || []).filter((o) => o.date >= cutoff)
    if (!recent.length) continue
    byStage[pattern.stage] = (byStage[pattern.stage] || 0) + recent.length
    evidence += recent.length
  }

  const stages = Object.keys(byStage).map(Number)
  return {
    stage: stages.length ? Math.min(...stages) : null,
    byStage,
    evidence,
  }
}

// Teachability: current stage + 1. Null when the diagnosis has no evidence,
// which callers treat as "no ceiling".
export function stageCeiling(diagnosis) {
  return diagnosis && diagnosis.stage != null ? diagnosis.stage + 1 : null
}

// Patterns with no stage (rule-governed morphology — case, adjective endings,
// tense) are learnable at any point and are never gated. Only the word-order
// sequence is stage-bound.
export function isAdmissible(code, ceiling) {
  if (ceiling == null) return true
  const pattern = patternFor(code)
  if (!pattern || pattern.stage == null) return true
  return pattern.stage <= ceiling
}

export function admissibleCodes(codes, ceiling) {
  return (codes || []).filter((c) => isAdmissible(c, ceiling))
}

// Prompt fragment: keeps the task generator from demanding structures the
// learner cannot yet process.
export function stagePromptBlock(ceiling) {
  if (ceiling == null) return ''
  const beyond = TAXONOMY.filter((p) => p.stage != null && p.stage > ceiling)
  if (!beyond.length) return ''
  return `Processability ceiling: stage ${ceiling} (${STAGE_NAMES[ceiling] || 'unknown'}). Do not build the task around structures above this stage — ${beyond
    .map((p) => `${p.code} (stage ${p.stage})`)
    .join(', ')}. They may appear incidentally if the learner reaches for them, but must not be what the task requires.`
}
