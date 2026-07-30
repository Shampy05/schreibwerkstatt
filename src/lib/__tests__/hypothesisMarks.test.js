import { describe, it, expect } from 'vitest'
import {
  findHypothesisMarks,
  hasHypothesisMarks,
  removeMarkAt,
  removeAllMarks,
} from '../hypothesisMarks'

describe('findHypothesisMarks', () => {
  it('finds a mark glued to a word', () => {
    const marks = findHypothesisMarks('Ich habe dem? Mann geholfen.')
    expect(marks).toHaveLength(1)
    expect(marks[0].index).toBe(12)
    expect(marks[0].before.endsWith('dem?')).toBe(true)
  })

  it('finds every mark, in order', () => {
    expect(findHypothesisMarks('der? Hund mit dem? Ball').map((m) => m.index)).toEqual([3, 17])
  })

  it('flags a sentence-final "?" too — it cannot be told apart by rule', () => {
    // German capitalises every noun, so "dem? Mann" and "dir? Mein Hund" are
    // structurally identical. Guessing here would destroy real punctuation.
    const marks = findHypothesisMarks('Wie geht es dir?')
    expect(marks).toHaveLength(1)
    expect(marks[0].atEnd).toBe(true)
  })

  it('ignores a "?" that is not attached to a word', () => {
    expect(findHypothesisMarks('was ? soll das')).toEqual([])
    expect(findHypothesisMarks('?')).toEqual([])
  })

  it('handles empty and missing text', () => {
    expect(findHypothesisMarks('')).toEqual([])
    expect(findHypothesisMarks(undefined)).toEqual([])
    expect(hasHypothesisMarks('sauberer Text.')).toBe(false)
    expect(hasHypothesisMarks('dem? Mann')).toBe(true)
  })
})

describe('removeMarkAt', () => {
  it('removes exactly the one mark', () => {
    expect(removeMarkAt('dem? Mann', 3)).toBe('dem Mann')
  })

  it('leaves the text alone when the index is not a "?"', () => {
    expect(removeMarkAt('dem? Mann', 0)).toBe('dem? Mann')
    expect(removeMarkAt('dem? Mann', 99)).toBe('dem? Mann')
    expect(removeMarkAt('dem? Mann', -1)).toBe('dem? Mann')
    expect(removeMarkAt(undefined, 0)).toBe('')
  })

  it('keeps the other marks intact', () => {
    expect(removeMarkAt('der? Hund mit dem? Ball', 3)).toBe('der Hund mit dem? Ball')
  })
})

describe('removeAllMarks', () => {
  it('removes every mark without index drift', () => {
    expect(removeAllMarks('der? Hund mit dem? Ball und der? Katze')).toBe(
      'der Hund mit dem Ball und der Katze'
    )
  })

  it('is a no-op on clean text', () => {
    expect(removeAllMarks('Ein sauberer Text.')).toBe('Ein sauberer Text.')
    expect(removeAllMarks('')).toBe('')
  })
})
