import { describe, it, expect } from 'vitest'
import {
  CEFR_LEVELS,
  DEFAULT_LEVEL,
  normalizeLevel,
  levelDescriptor,
  nextLevel,
  taskLevelBlock,
  analysisLevelBlock,
} from '../level'

describe('CEFR level', () => {
  it('every level has a full descriptor', () => {
    for (const l of CEFR_LEVELS) {
      const d = levelDescriptor(l)
      expect(d.label, l).toBeTruthy()
      expect(d.task, l).toBeTruthy()
      expect(d.analysis, l).toBeTruthy()
      expect(d.sentences, l).toMatch(/\d+–\d+/)
    }
  })

  it('normalizes junk to the default', () => {
    expect(normalizeLevel('C3')).toBe(DEFAULT_LEVEL)
    expect(normalizeLevel(undefined)).toBe(DEFAULT_LEVEL)
    expect(normalizeLevel('B2')).toBe('B2')
  })

  it('reaches one level up, and stops at the ceiling', () => {
    expect(nextLevel('B1')).toBe('B2')
    expect(nextLevel('B2')).toBe('C1')
    expect(nextLevel('C1')).toBe('C1')
  })

  it('task block names both the current level and the reach', () => {
    const block = taskLevelBlock('B1')
    expect(block).toContain('B1')
    expect(block).toContain('B2')
    expect(block).toContain('5–10')
  })

  it('C1 task block does not promise a level above itself', () => {
    expect(taskLevelBlock('C1')).not.toMatch(/Reach toward/)
  })

  it('analysis strictness rises with level', () => {
    expect(analysisLevelBlock('A2')).toMatch(/Do not flag register/)
    expect(analysisLevelBlock('C1')).toMatch(/near-native/)
  })
})
