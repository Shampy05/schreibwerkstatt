import { describe, it, expect } from 'vitest'
import { normalizeQuote, sameError, matchError, isSameAsAny, resolveWorking } from '../errorMatch'

const err = (quote, patternCode = 'WO-VF') => ({ quote, patternCode })

describe('normalizeQuote', () => {
  it('strips punctuation, case and repeated whitespace', () => {
    expect(normalizeQuote('  Weil  es  IST, ')).toBe('weil es ist')
  })

  it('keeps non-ASCII letters intact', () => {
    expect(normalizeQuote('Über die Straße!')).toBe('über die straße')
  })

  it('survives missing input', () => {
    expect(normalizeQuote(undefined)).toBe('')
    expect(normalizeQuote(null)).toBe('')
  })
})

describe('sameError', () => {
  it('matches identical errors', () => {
    expect(sameError(err('weil es ist'), err('weil es ist'))).toBe(true)
  })

  it('matches across punctuation and case differences', () => {
    expect(sameError(err('Weil es ist,'), err('weil es ist'))).toBe(true)
  })

  it('matches a re-quote with different span boundaries — the whole point', () => {
    expect(sameError(err('weil es ist'), err('es ist'))).toBe(true)
    expect(sameError(err('es ist'), err('weil es ist'))).toBe(true)
  })

  it('never matches across pattern codes, however similar the span', () => {
    expect(sameError(err('weil es ist', 'WO-VF'), err('weil es ist', 'KAS-DAT'))).toBe(false)
  })

  it('does not match unrelated spans', () => {
    expect(sameError(err('weil es ist'), err('mit dem Hund'))).toBe(false)
  })

  it('treats an empty or missing quote as no match rather than a match on everything', () => {
    expect(sameError(err(''), err('weil es ist'))).toBe(false)
    expect(sameError(err('...'), err('weil es ist'))).toBe(false)
    expect(sameError(null, err('x'))).toBe(false)
    expect(sameError(err('x'), undefined)).toBe(false)
  })
})

describe('matchError / isSameAsAny', () => {
  const prior = [
    { ...err('mit dem Hund', 'KAS-DAT'), revealedRung: 4 },
    { ...err('weil es ist'), revealedRung: 3 },
  ]

  it('finds the prior entry so its revealed rung carries over', () => {
    expect(matchError(err('es ist'), prior).revealedRung).toBe(3)
  })

  it('returns null when nothing matches', () => {
    expect(matchError(err('ganz neu'), prior)).toBe(null)
    expect(matchError(err('x'), [])).toBe(null)
    expect(matchError(err('x'), undefined)).toBe(null)
  })

  it('isSameAsAny answers the dismissed-error question', () => {
    expect(isSameAsAny(err('Weil es ist!'), prior)).toBe(true)
    expect(isSameAsAny(err('etwas anderes'), prior)).toBe(false)
  })
})

describe('resolveWorking', () => {
  const working = [
    { ...err('weil es ist'), revealedRung: 3 },
    { ...err('mit dem Hund', 'KAS-DAT'), revealedRung: 5 },
  ]

  it('records an error the rewrite fixed, at the rung of help it needed', () => {
    expect(resolveWorking(working, [{ ...err('mit dem Hund', 'KAS-DAT') }])).toEqual([
      { quote: 'weil es ist', patternCode: 'WO-VF', rung: 3 },
    ])
  })

  it('resolves everything when the rewrite comes back clean', () => {
    expect(resolveWorking(working, [])).toHaveLength(2)
  })

  it('does NOT resolve an unfixed error the engine merely re-quoted differently', () => {
    // The regression this exists to prevent: "es ist" vs "weil es ist" used to
    // read as a fix, inventing an internalization the learner never earned.
    expect(resolveWorking(working, [err('es ist'), err('mit dem Hund', 'KAS-DAT')])).toEqual([])
  })

  it('survives empty inputs', () => {
    expect(resolveWorking(undefined, undefined)).toEqual([])
    expect(resolveWorking([], [err('x')])).toEqual([])
  })
})
