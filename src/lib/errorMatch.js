// Deciding whether two engine errors are "the same error".
//
// This is load-bearing for the one metric the app treats as progress. When a
// rewrite is checked, every old error that is NOT re-flagged is recorded as
// resolved at the rung the learner needed. Matching on an exact quote string
// made that fragile in both directions: a model that re-quoted an unfixed
// error with slightly different span boundaries ("weil es ist" vs "es ist")
// counted as a resolution — a false internalization signal in the ledger —
// while the same error re-entered the working list at rung 1, throwing away
// the rungs the learner had already climbed.
//
// Same pattern code + overlapping span is the honest test. Two genuinely
// distinct errors of the same code where one span contains the other will
// collapse into one; that is rarer, and less damaging, than inventing progress.

export function normalizeQuote(quote) {
  return (quote || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sameError(a, b) {
  if (!a || !b) return false
  if (a.patternCode !== b.patternCode) return false
  const x = normalizeQuote(a.quote)
  const y = normalizeQuote(b.quote)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function matchError(error, candidates) {
  return (candidates || []).find((c) => sameError(error, c)) || null
}

export function isSameAsAny(error, candidates) {
  return Boolean(matchError(error, candidates))
}

// Which of the errors being worked on were fixed by a rewrite: everything the
// fresh analysis no longer flags, recorded at the rung of help the learner
// actually needed. This is the ledger's progress signal (L4 → L2 → L1 =
// internalization), so a false positive here invents development that did not
// happen.
export function resolveWorking(working, stillFlagged) {
  return (working || [])
    .filter((old) => !(stillFlagged || []).some((n) => sameError(n, old)))
    .map((old) => ({ quote: old.quote, patternCode: old.patternCode, rung: old.revealedRung }))
}
