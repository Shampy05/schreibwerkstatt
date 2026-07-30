import { describe, it, expect } from 'vitest'
import { RUNGS, MAX_RUNG, nextRung, rungLabel, rungTrajectory } from '../ladder'

describe('ladder', () => {
  it('has five rungs ordered locate → correct', () => {
    expect(MAX_RUNG).toBe(5)
    expect(RUNGS.map((r) => r.key)).toEqual(['locate', 'underline', 'code', 'explain', 'correct'])
    expect(RUNGS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5])
  })

  it('nextRung advances and exhausts', () => {
    expect(nextRung(1)).toBe(2)
    expect(nextRung(4)).toBe(5)
    expect(nextRung(5)).toBeNull()
  })

  it('rungLabel resolves levels', () => {
    expect(rungLabel(1)).toBe('Locate it yourself')
    expect(rungLabel(5)).toBe('Show the correction')
    expect(rungLabel(9)).toBeNull()
  })

  it('rungTrajectory formats a falling trajectory', () => {
    expect(rungTrajectory([4, 2, 1])).toBe('L4 → L2 → L1')
    expect(rungTrajectory([])).toBe('')
  })
})
