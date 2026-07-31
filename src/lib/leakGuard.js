// Keeping rung 4 from becoming rung 5.
//
// The ladder's whole mechanism is that a metalinguistic explanation comes
// BEFORE the correction and does not contain it — the learner still has to
// produce the fix. The engine is instructed accordingly, and measurably
// ignores it: grok-4.5 and glm-5.2 both returned explanations ending "so deine
// is required" / 'must be "deine"' for a correction of exactly `deine`. Every
// model tested leaked, so this cannot be left to the prompt.
//
// The answer is precisely what the correction ADDS to the quote. Words already
// present in the learner's own text are not a revelation and stay — including
// trigger words like `weil`, which the task generator is explicitly allowed to
// name. Only the new material is redacted.

const PLACEHOLDER = '…'

// Letters, digits, apostrophes; German umlauts and ß are letters under \p{L}.
function tokenize(text) {
  return (text || '').match(/[\p{L}\p{N}]+/gu) || []
}

// Tokens the correction introduces that the quote does not already contain.
export function addedTokens(quote, correction) {
  const had = new Set(tokenize(quote).map((t) => t.toLowerCase()))
  const out = []
  const seen = new Set()
  for (const tok of tokenize(correction)) {
    const key = tok.toLowerCase()
    // One-character tokens are too noisy to redact safely.
    if (tok.length < 2 || had.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(tok)
  }
  return out
}

export function explanationLeaks(explanation, quote, correction) {
  return addedTokens(quote, correction).some((tok) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(tok)}(?![\\p{L}\\p{N}])`, 'iu').test(explanation || '')
  )
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Replace any leaked answer-words with a placeholder, keeping the rule intact.
// Redacting beats discarding: "the possessive must agree with feminine
// Schildkröte, so … is required" still teaches the rule, which is the whole
// point of the rung. Surrounding quote marks go with it so we don't leave „…“.
export function redactLeak(explanation, quote, correction) {
  let out = explanation || ''
  for (const tok of addedTokens(quote, correction)) {
    const pattern = new RegExp(
      `["'„“”»«]?(?<![\\p{L}\\p{N}])${escapeRegExp(tok)}(?![\\p{L}\\p{N}])["'„“”»«]?`,
      'giu'
    )
    out = out.replace(pattern, PLACEHOLDER)
  }
  // Collapse runs left by adjacent redactions ("… …" -> "…").
  return out.replace(/(?:\s*…\s*){2,}/g, ` ${PLACEHOLDER} `).replace(/\s{2,}/g, ' ').trim()
}
