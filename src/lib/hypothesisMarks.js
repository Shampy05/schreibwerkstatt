// Trailing "?" is the learner's hypothesis marker (Swain's hypothesis-testing
// function made explicit): „dem? Mann“ means "I think it's dem, check me". The
// analysis engine is told the "?" itself is not an error, which is right — but
// it means a text can come back CLEAN with the scaffolding still in it and get
// stored as the session's final text. A session is supposed to end in a
// verified clean text, and that isn't one.
//
// Stripping automatically would be wrong. A real question mark is attached to
// the preceding word exactly like a hypothesis mark, and case gives nothing
// away in German because every noun is capitalised — „dem? Mann“ and „Wie geht
// es dir? Mein Hund…“ are structurally identical. Any heuristic either destroys
// real punctuation or misses the common case.
//
// So: find every candidate, show it in context, let the learner remove them one
// at a time. No guessing, no false destruction.

const CONTEXT = 24

// A "?" glued to the preceding character. A "?" after whitespace isn't a mark
// on a word, so it is left out entirely.
export function findHypothesisMarks(text) {
  const out = []
  const src = text || ''
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '?') continue
    const prev = src[i - 1]
    if (!prev || /\s/.test(prev)) continue
    out.push({
      index: i,
      before: src.slice(Math.max(0, i - CONTEXT), i + 1),
      after: src.slice(i + 1, i + 1 + CONTEXT),
      atEnd: i === src.length - 1,
    })
  }
  return out
}

export function hasHypothesisMarks(text) {
  return findHypothesisMarks(text).length > 0
}

// Remove one "?" by position. Indices come from a fresh findHypothesisMarks
// over the current text, so they can't go stale between removals.
export function removeMarkAt(text, index) {
  const src = text || ''
  if (!Number.isInteger(index) || index < 0 || index >= src.length) return src
  if (src[index] !== '?') return src
  return src.slice(0, index) + src.slice(index + 1)
}

// Remove all of them at once, for a learner who knows none were real questions.
export function removeAllMarks(text) {
  const marks = findHypothesisMarks(text)
  let out = text || ''
  // Right to left so earlier indices stay valid.
  for (let i = marks.length - 1; i >= 0; i--) out = removeMarkAt(out, marks[i].index)
  return out
}
