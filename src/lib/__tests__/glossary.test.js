import { describe, it, expect } from 'vitest'
import { normalizeGlossary } from '../engine'

describe('normalizeGlossary', () => {
  it('keeps well-formed dictionary entries', () => {
    expect(
      normalizeGlossary([
        { de: 'der Wasserhahn, -hähne', en: 'tap' },
        { de: 'überlaufen', en: 'to overflow' },
      ])
    ).toEqual([
      { de: 'der Wasserhahn, -hähne', en: 'tap' },
      { de: 'überlaufen', en: 'to overflow' },
    ])
  })

  it('returns [] for a missing or non-array glossary', () => {
    expect(normalizeGlossary(undefined)).toEqual([])
    expect(normalizeGlossary(null)).toEqual([])
    expect(normalizeGlossary('überlaufen')).toEqual([])
  })

  it('drops malformed and empty entries', () => {
    expect(
      normalizeGlossary([
        null,
        { de: 'überlaufen' },
        { en: 'tap' },
        { de: '  ', en: 'nothing' },
        { de: 'undicht', en: '' },
        { de: 'undicht', en: 'leaky' },
      ])
    ).toEqual([{ de: 'undicht', en: 'leaky' }])
  })

  it('drops entries long enough to be a clause — the vocabulary list is not a place to leak structure', () => {
    expect(
      normalizeGlossary([
        { de: 'weil der Wasserhahn übergelaufen ist, war alles nass', en: 'because…' },
        { de: 'Der Hahn ist übergelaufen.', en: 'the tap overflowed' },
        { de: 'der Eimer, -', en: 'bucket' },
      ])
    ).toEqual([{ de: 'der Eimer, -', en: 'bucket' }])
  })

  it('dedupes case-insensitively and caps at six', () => {
    expect(normalizeGlossary([{ de: 'der Eimer', en: 'bucket' }, { de: 'DER EIMER', en: 'pail' }])).toHaveLength(1)
    const many = Array.from({ length: 10 }, (_, i) => ({ de: `wort${i}`, en: `word${i}` }))
    expect(normalizeGlossary(many)).toHaveLength(6)
  })
})
