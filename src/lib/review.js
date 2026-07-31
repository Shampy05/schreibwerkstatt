// The end-of-session review: what the session actually produced, and which one
// or two patterns are worth writing a sentence about.
//
// This exists because the languaging step used to render one blank text box per
// pattern code with a single hardcoded example under all of them. You cannot
// reflect on a code — Swain's languaging works on the gap the learner actually
// experienced, so the error has to be in front of them. And asking for a note
// on every code contradicts the focused-WCF finding the ledger already applies
// when it caps active targets: faced with five blank boxes you fill none.
//
// So: rank the session's patterns by how much help they needed, ask for a note
// on the top few, and log the rest silently.
//
// Pure. `ledger` must be the ledger as it stands BEFORE this session lands,
// which is what the store holds until completeSession runs — that's what makes
// `priorCount` genuinely prior.

import { patternFor } from './taxonomy'
import { patternStats } from './ledger'
import { rungTrajectory } from './ladder'
import { isAdmissible } from './stage'

export const MAX_NOTE_ASKS = 2

// A question, not an example. The taxonomy's own `hint` is the rule itself, so
// showing it here would answer the question we're asking — the same
// prompts-before-recasts logic the ladder runs on. Keyed by taxonomy group,
// because the useful question is about the kind of decision, not the code.
const QUESTIONS = {
  'Word order': 'What decides where the verb goes here?',
  Case: 'What decides the case in this phrase?',
  Agreement: 'What does the ending have to agree with?',
  Verbs: 'What makes this the right form?',
  Other: 'What will you check before you submit next time?',
}

export function noteQuestion(code) {
  return QUESTIONS[patternFor(code)?.group] || QUESTIONS.Other
}

// How much a pattern is worth a written note. Reading: the rung you needed is
// the base signal (rung 5 = you could not produce it unaided), with a bump for
// a pattern you have hit before, one you are actively targeting, and one you
// never did fix. A repeat you self-corrected at rung 1 scores low on purpose —
// that is internalization, and it needs no note.
function scoreOf({ maxRung, priorCount, isTarget, unresolved }) {
  return maxRung + (priorCount > 0 ? 1 : 0) + (isTarget ? 1 : 0) + (unresolved ? 1 : 0)
}

function cleanCorrection(quote, correction) {
  const c = (correction || '').trim()
  if (!c || c === (quote || '').trim()) return null
  return c
}

export function buildReview({
  recorded = [],
  ledger = {},
  activeTargets = [],
  maxNotes = MAX_NOTE_ASKS,
} = {}) {
  const fixes = []
  const byCode = new Map()

  for (const e of recorded) {
    if (!e?.patternCode) continue
    const fix = {
      quote: e.quote || '',
      correction: cleanCorrection(e.quote, e.correction),
      patternCode: e.patternCode,
      name: patternFor(e.patternCode)?.name || e.patternCode,
      rung: e.rung ?? null,
      unresolved: Boolean(e.unresolved),
    }
    fixes.push(fix)

    if (!byCode.has(e.patternCode)) byCode.set(e.patternCode, [])
    byCode.get(e.patternCode).push(fix)
  }

  const patterns = [...byCode.entries()].map(([code, occurrences]) => {
    const prior = patternStats(ledger, code)
    const pattern = patternFor(code)
    const maxRung = Math.max(...occurrences.map((o) => o.rung || 1))
    const unresolved = occurrences.some((o) => o.unresolved)
    const isTarget = activeTargets.includes(code)
    const notes = ledger[code]?.notes || []
    return {
      code,
      name: pattern?.name || code,
      group: pattern?.group || 'Other',
      question: noteQuestion(code),
      occurrences,
      count: occurrences.length,
      maxRung,
      unresolved,
      isTarget,
      priorCount: prior.count,
      priorLastSeen: prior.lastSeen,
      // Last four is enough to read the direction without a wall of arrows.
      priorTrajectory: rungTrajectory(prior.rungs.slice(-4)),
      // Rewriting your own rule when you break it again beats authoring a fresh
      // sentence in a vacuum — and it is the anti-stabilization mechanic.
      priorNote: notes.length ? notes[notes.length - 1] : null,
      score: scoreOf({ maxRung, priorCount: prior.count, isTarget, unresolved }),
      askForNote: false,
    }
  })

  patterns.sort(
    (a, b) =>
      b.score - a.score ||
      b.priorCount - a.priorCount ||
      b.count - a.count ||
      b.maxRung - a.maxRung ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  )
  for (const p of patterns.slice(0, Math.max(0, maxNotes))) p.askForNote = true

  return { fixes, patterns }
}

// The moment the evidence is freshest is the moment to offer a new target, so
// the end of a session is where the loop closes. Deliberately conservative: it
// must be a pattern seen more than once, admissible under the Processability
// ceiling, and there must be room — the cap is the whole point of the cap.
export function promotionCandidate(
  patterns,
  { activeTargets = [], ceiling = null, max = 3 } = {}
) {
  if (activeTargets.length >= max) return null
  const found = (patterns || []).find(
    (p) =>
      !activeTargets.includes(p.code) &&
      p.priorCount + p.count >= 2 &&
      isAdmissible(p.code, ceiling)
  )
  return found ? found.code : null
}
