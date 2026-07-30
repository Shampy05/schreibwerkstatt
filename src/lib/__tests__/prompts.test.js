import { describe, it, expect } from 'vitest'
import { PROMPTS, pickPrompt } from '../prompts'
import { CODE_SET } from '../taxonomy'

describe('prompt bank', () => {
  it('every prompt tag is a real taxonomy code', () => {
    for (const p of PROMPTS) {
      for (const tag of p.tags) {
        expect(CODE_SET.has(tag), `${p.id} has unknown tag ${tag}`).toBe(true)
      }
    }
  })

  it('biases toward active targets when one matches', () => {
    const picked = pickPrompt({ activeTargets: ['V-K2'], random: () => 0 })
    expect(picked.tags).toContain('V-K2')
  })

  it('respects the exclude list', () => {
    const excludeAllButOne = PROMPTS.slice(1).map((p) => p.id)
    const picked = pickPrompt({ exclude: excludeAllButOne, random: () => 0.99 })
    expect(picked.id).toBe(PROMPTS[0].id)
  })

  it('falls back to the full pool when everything is excluded', () => {
    const picked = pickPrompt({ exclude: PROMPTS.map((p) => p.id), random: () => 0 })
    expect(picked).toBeTruthy()
  })
})
