import { describe, it, expect } from 'vitest'
import {
  diagnoseStage,
  stageCeiling,
  isAdmissible,
  admissibleCodes,
  stagePromptBlock,
} from '../stage'
import { recordOccurrence } from '../ledger'

const NOW = new Date('2026-07-30')
const occ = (date) => ({ sessionId: 's', date, quote: 'x', rung: 3 })

// WO-SEP = stage 3, WO-V2 = stage 4, WO-VF = stage 5, ADJ-END/KAS-DAT = unstaged.
describe('processability diagnosis', () => {
  it('reports no stage when there is no staged evidence', () => {
    const d = diagnoseStage({}, { now: NOW })
    expect(d.stage).toBeNull()
    expect(stageCeiling(d)).toBeNull()
  })

  it('ignores unstaged patterns entirely', () => {
    let l = recordOccurrence({}, 'ADJ-END', occ('2026-07-29'))
    l = recordOccurrence(l, 'KAS-DAT', occ('2026-07-29'))
    expect(diagnoseStage(l, { now: NOW }).stage).toBeNull()
  })

  it('takes the LOWEST unstable stage, not the highest', () => {
    let l = recordOccurrence({}, 'WO-VF', occ('2026-07-28'))
    l = recordOccurrence(l, 'WO-SEP', occ('2026-07-28'))
    const d = diagnoseStage(l, { now: NOW })
    expect(d.stage).toBe(3)
    expect(stageCeiling(d)).toBe(4)
  })

  it('ignores errors outside the window', () => {
    let l = recordOccurrence({}, 'WO-SEP', occ('2026-01-01'))
    l = recordOccurrence(l, 'WO-V2', occ('2026-07-28'))
    expect(diagnoseStage(l, { now: NOW }).stage).toBe(4)
  })

  it('counts evidence per stage', () => {
    let l = recordOccurrence({}, 'WO-V2', occ('2026-07-28'))
    l = recordOccurrence(l, 'WO-V2', occ('2026-07-29'))
    l = recordOccurrence(l, 'WO-VF', occ('2026-07-29'))
    const d = diagnoseStage(l, { now: NOW })
    expect(d.byStage).toEqual({ 4: 2, 5: 1 })
    expect(d.evidence).toBe(3)
  })
})

describe('teachability gate', () => {
  it('admits at or below the ceiling and refuses above it', () => {
    expect(isAdmissible('WO-SEP', 4)).toBe(true) // stage 3
    expect(isAdmissible('WO-V2', 4)).toBe(true) // stage 4
    expect(isAdmissible('WO-VF', 4)).toBe(false) // stage 5
  })

  it('never gates unstaged morphology', () => {
    expect(isAdmissible('ADJ-END', 3)).toBe(true)
    expect(isAdmissible('KAS-DAT', 3)).toBe(true)
    expect(isAdmissible('V-K2', 3)).toBe(true)
  })

  it('applies no gate at all without a ceiling', () => {
    expect(isAdmissible('WO-VF', null)).toBe(true)
    expect(admissibleCodes(['WO-VF', 'PRO-REL'], null)).toEqual(['WO-VF', 'PRO-REL'])
  })

  it('filters a code list', () => {
    expect(admissibleCodes(['WO-SEP', 'WO-VF', 'ADJ-END'], 4)).toEqual(['WO-SEP', 'ADJ-END'])
  })

  it('prompt block names the ceiling and the withheld structures', () => {
    const block = stagePromptBlock(4)
    expect(block).toContain('stage 4')
    expect(block).toContain('WO-VF')
    expect(block).not.toContain('WO-SEP')
    expect(stagePromptBlock(null)).toBe('')
  })
})
