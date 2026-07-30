import { describe, it, expect } from 'vitest'
import { PROMPTS, pickPrompt, isBankPrompt } from '../prompts'
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

  it('isBankPrompt keeps generated ids out of the recent list', () => {
    // Storing gen-<uuid> ids filled all six recent slots with ids the bank has
    // never heard of, so `exclude` matched nothing and the bank repeated itself.
    expect(isBankPrompt(PROMPTS[0].id)).toBe(true)
    expect(isBankPrompt('gen-6f1c4b9a-2f7e-4a3d-9b11-8c2d0e5a7f31')).toBe(false)
    expect(isBankPrompt(null)).toBe(false)
    expect(isBankPrompt(undefined)).toBe(false)
  })
})
