import { describe, it, expect } from 'vitest'
import { buildReview, promotionCandidate, noteQuestion, MAX_NOTE_ASKS } from '../review'

const rec = (patternCode, quote, rung, extra = {}) => ({ patternCode, quote, rung, ...extra })

// A ledger as it stands BEFORE the session under review lands.
function ledgerOf(entries) {
  const out = {}
  for (const [code, { occurrences = [], notes = [] }] of Object.entries(entries)) {
    out[code] = { code, occurrences, notes }
  }
  return out
}

describe('noteQuestion', () => {
  it('asks about the kind of decision the pattern involves', () => {
    expect(noteQuestion('WO-VF')).toMatch(/verb goes/)
    expect(noteQuestion('KAS-DAT')).toMatch(/case/)
    expect(noteQuestion('ADJ-END')).toMatch(/agree with/)
    expect(noteQuestion('V-K2')).toMatch(/right form/)
  })

  it('falls back to the catch-all question for an unknown code', () => {
    expect(noteQuestion('NOT-A-CODE')).toBe(noteQuestion('ORTH'))
  })
})

describe('buildReview — fixes', () => {
  it('pairs each error with its correction and its pattern name', () => {
    const { fixes } = buildReview({
      recorded: [rec('KAS-DAT', 'mit meiner Katzenklappe', 4, { correction: 'durch meine Katzenklappe' })],
    })
    expect(fixes).toEqual([
      {
        quote: 'mit meiner Katzenklappe',
        correction: 'durch meine Katzenklappe',
        patternCode: 'KAS-DAT',
        name: 'Dative objects & dative verbs',
        rung: 4,
        unresolved: false,
      },
    ])
  })

  it('drops a correction that is missing or identical to the quote', () => {
    const { fixes } = buildReview({
      recorded: [rec('ORTH', 'katze', 1), rec('ORTH', 'Hund', 1, { correction: ' Hund ' })],
    })
    expect(fixes.map((f) => f.correction)).toEqual([null, null])
  })

  it('ignores an entry with no pattern code — it would key nothing in the ledger', () => {
    const { fixes, patterns } = buildReview({ recorded: [{ quote: 'x', rung: 2 }] })
    expect(fixes).toEqual([])
    expect(patterns).toEqual([])
  })
})

describe('buildReview — which patterns earn a note', () => {
  it('ranks the pattern that needed the most help first', () => {
    const { patterns } = buildReview({
      recorded: [rec('ORTH', 'katze', 1), rec('WO-VF', 'weil es ist gut', 5)],
    })
    expect(patterns.map((p) => p.code)).toEqual(['WO-VF', 'ORTH'])
    expect(patterns[0].askForNote).toBe(true)
  })

  it('asks for at most MAX_NOTE_ASKS notes however many patterns the session had', () => {
    const { patterns } = buildReview({
      recorded: [
        rec('ORTH', 'a', 3),
        rec('WO-VF', 'b', 3),
        rec('KAS-DAT', 'c', 3),
        rec('N-PL', 'd', 3),
      ],
    })
    expect(patterns).toHaveLength(4)
    expect(patterns.filter((p) => p.askForNote)).toHaveLength(MAX_NOTE_ASKS)
  })

  it('lifts a repeat above a first-time error that needed the same help', () => {
    const { patterns } = buildReview({
      recorded: [rec('ORTH', 'a', 3), rec('KAS-DAT', 'b', 3)],
      ledger: ledgerOf({ 'KAS-DAT': { occurrences: [{ date: '2026-07-01', rung: 4 }] } }),
    })
    expect(patterns[0].code).toBe('KAS-DAT')
  })

  it('does NOT lift a repeat the learner self-corrected — that is internalization, not a gap', () => {
    // KAS-DAT: seen before but fixed at rung 1. WO-VF: brand new, needed rung 4.
    const { patterns } = buildReview({
      recorded: [rec('KAS-DAT', 'a', 1), rec('WO-VF', 'b', 4)],
      ledger: ledgerOf({ 'KAS-DAT': { occurrences: [{ date: '2026-07-01', rung: 2 }] } }),
    })
    expect(patterns[0].code).toBe('WO-VF')
  })

  it('lifts an error that was never fixed', () => {
    const { patterns } = buildReview({
      recorded: [rec('ORTH', 'a', 3), rec('N-PL', 'b', 3, { unresolved: true })],
    })
    expect(patterns[0].code).toBe('N-PL')
    expect(patterns[0].unresolved).toBe(true)
  })

  it('lifts an active target over an equal non-target', () => {
    const { patterns } = buildReview({
      recorded: [rec('ORTH', 'a', 2), rec('N-PL', 'b', 2)],
      activeTargets: ['N-PL'],
    })
    expect(patterns[0].code).toBe('N-PL')
    expect(patterns[0].isTarget).toBe(true)
  })

  it('orders deterministically when everything ties', () => {
    const recorded = [rec('WO-VF', 'a', 2), rec('KAS-DAT', 'b', 2), rec('ORTH', 'c', 2)]
    const once = buildReview({ recorded }).patterns.map((p) => p.code)
    const again = buildReview({ recorded: [...recorded].reverse() }).patterns.map((p) => p.code)
    expect(once).toEqual(again)
  })
})

describe('buildReview — ledger context', () => {
  it('carries the prior count, trajectory and last note for a repeat', () => {
    const { patterns } = buildReview({
      recorded: [rec('KAS-DAT', 'mit dem Haus', 2)],
      ledger: ledgerOf({
        'KAS-DAT': {
          occurrences: [
            { date: '2026-06-01', rung: 5 },
            { date: '2026-06-20', rung: 4 },
            { date: '2026-07-10', rung: 3 },
          ],
          notes: [
            { date: '2026-06-01', text: 'first attempt at the rule' },
            { date: '2026-07-10', text: 'mit/aus/bei/nach/von/zu always take dative' },
          ],
        },
      }),
    })
    expect(patterns[0].priorCount).toBe(3)
    expect(patterns[0].priorTrajectory).toBe('L5 → L4 → L3')
    expect(patterns[0].priorLastSeen).toBe('2026-07-10')
    // The most recent note, so the learner sharpens it rather than restating it.
    expect(patterns[0].priorNote.text).toBe('mit/aus/bei/nach/von/zu always take dative')
  })

  it('reports a first-time pattern as having no history', () => {
    const { patterns } = buildReview({ recorded: [rec('ADJ-END', 'ein großes Hund', 3)] })
    expect(patterns[0].priorCount).toBe(0)
    expect(patterns[0].priorTrajectory).toBe('')
    expect(patterns[0].priorNote).toBe(null)
  })

  it('groups repeated occurrences of one pattern into a single block', () => {
    const { fixes, patterns } = buildReview({
      recorded: [rec('ORTH', 'katze', 1), rec('WO-VF', 'weil es ist', 4), rec('ORTH', 'hund', 2)],
    })
    expect(fixes).toHaveLength(3)
    expect(patterns).toHaveLength(2)
    const orth = patterns.find((p) => p.code === 'ORTH')
    expect(orth.count).toBe(2)
    expect(orth.maxRung).toBe(2)
    expect(orth.occurrences.map((o) => o.quote)).toEqual(['katze', 'hund'])
  })

  it('survives an empty session', () => {
    expect(buildReview()).toEqual({ fixes: [], patterns: [] })
    expect(buildReview({ recorded: [] })).toEqual({ fixes: [], patterns: [] })
  })
})

describe('promotionCandidate', () => {
  const patterns = [
    { code: 'KAS-DAT', priorCount: 2, count: 1 },
    { code: 'WO-VF', priorCount: 4, count: 1 },
  ]

  it('offers the top-ranked recurring pattern', () => {
    expect(promotionCandidate(patterns, { activeTargets: [], ceiling: null })).toBe('KAS-DAT')
  })

  it('skips one that is already a target', () => {
    expect(promotionCandidate(patterns, { activeTargets: ['KAS-DAT'], ceiling: null })).toBe('WO-VF')
  })

  it('never offers a one-off — a single error is not a pattern yet', () => {
    expect(promotionCandidate([{ code: 'ORTH', priorCount: 0, count: 1 }], {})).toBe(null)
  })

  it('respects the Processability ceiling', () => {
    // WO-VF is stage 5; a learner still unstable at stage 3 has a ceiling of 4.
    expect(promotionCandidate([{ code: 'WO-VF', priorCount: 3, count: 1 }], { ceiling: 4 })).toBe(null)
    // Unstaged morphology is never gated.
    expect(promotionCandidate([{ code: 'KAS-DAT', priorCount: 3, count: 1 }], { ceiling: 4 })).toBe(
      'KAS-DAT'
    )
  })

  it('offers nothing when the target slots are full — the cap is the point', () => {
    expect(promotionCandidate(patterns, { activeTargets: ['A', 'B', 'C'], max: 3 })).toBe(null)
  })

  it('survives no patterns', () => {
    expect(promotionCandidate(undefined, {})).toBe(null)
  })
})
