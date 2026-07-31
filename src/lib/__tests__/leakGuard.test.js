import { describe, it, expect } from 'vitest'
import { addedTokens, explanationLeaks, redactLeak } from '../leakGuard'

describe('addedTokens', () => {
  it('returns only what the correction introduces', () => {
    expect(addedTokens('deines Haustierschildkröte', 'deine Haustierschildkröte')).toEqual(['deine'])
  })

  it('ignores words the learner already wrote', () => {
    // `weil` is in the quote, so naming it is not a revelation — the task
    // generator is explicitly allowed to name trigger words.
    expect(addedTokens('weil es ist', 'weil es ist')).toEqual([])
    expect(addedTokens('weil es ist gut', 'weil es gut ist')).toEqual([])
  })

  it('is case-insensitive about what counted as already present', () => {
    expect(addedTokens('Deine Katze', 'deine Katze')).toEqual([])
  })

  it('dedupes and skips one-character noise', () => {
    expect(addedTokens('x', 'a b ab ab')).toEqual(['ab'])
  })

  it('survives empty input', () => {
    expect(addedTokens('', '')).toEqual([])
    expect(addedTokens(undefined, undefined)).toEqual([])
  })
})

describe('explanationLeaks', () => {
  const quote = 'deines Haustierschildkröte'
  const correction = 'deine Haustierschildkröte'

  it('catches the real leaks both models produced', () => {
    expect(
      explanationLeaks(
        'The possessive must agree with feminine Schildkröte in the nominative, so deine is required.',
        quote,
        correction
      )
    ).toBe(true)
    expect(
      explanationLeaks('"Schildkröte" is feminine, so the possessive pronoun must be "deine".', quote, correction)
    ).toBe(true)
  })

  it('passes an explanation that names the rule without the answer', () => {
    expect(
      explanationLeaks(
        'The possessive determiner must agree with the noun’s gender, and Schildkröte is feminine.',
        quote,
        correction
      )
    ).toBe(false)
  })

  it('does not fire on a substring inside a longer word', () => {
    expect(explanationLeaks('Deiner Meinung nach ist Deineswegen falsch.', 'x', 'Deine')).toBe(false)
  })
})

describe('redactLeak', () => {
  it('removes the answer but keeps the rule', () => {
    expect(
      redactLeak(
        'The possessive must agree with feminine Schildkröte in the nominative, so deine is required.',
        'deines Haustierschildkröte',
        'deine Haustierschildkröte'
      )
    ).toBe('The possessive must agree with feminine Schildkröte in the nominative, so … is required.')
  })

  it('takes surrounding quote marks with it', () => {
    expect(
      redactLeak(
        '"Schildkröte" is feminine, so the possessive pronoun must be "deine".',
        'deines Haustierschildkröte',
        'deine Haustierschildkröte'
      )
    ).toBe('"Schildkröte" is feminine, so the possessive pronoun must be ….')
  })

  it('leaves a clean explanation untouched', () => {
    const clean = 'Subordinate clauses introduced by weil put the finite verb last.'
    expect(redactLeak(clean, 'weil es ist gut', 'weil es gut ist')).toBe(clean)
  })

  it('collapses adjacent redactions instead of leaving a row of ellipses', () => {
    const out = redactLeak('Use hat gegessen here.', 'esst', 'hat gegessen')
    expect(out).not.toMatch(/…\s*…/)
    expect(out).toContain('…')
  })

  it('survives empty input', () => {
    expect(redactLeak('', 'a', 'b')).toBe('')
    expect(redactLeak(undefined, undefined, undefined)).toBe('')
  })
})
