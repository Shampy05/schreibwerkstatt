import { describe, it, expect } from 'vitest'
import { buildLedger, patternStats } from '../ledger'

// The ledger is derived from sessions rather than stored, so this fold is the
// only thing standing between the DB and every ledger surface in the app.
const sessions = [
  {
    id: 's1',
    date: '2026-07-20',
    errors: [
      { quote: 'weil es ist', patternCode: 'WO-VF', rung: 4 },
      { quote: 'deutsche Bücher', patternCode: 'ADJ-END', rung: 3 },
    ],
    notes: { 'WO-VF': 'verb last after weil' },
  },
  {
    id: 's2',
    date: '2026-07-28',
    errors: [{ quote: 'weil ich bin', patternCode: 'WO-VF', rung: 2 }],
    notes: {},
  },
]

describe('buildLedger', () => {
  it('folds occurrences across sessions in order', () => {
    const ledger = buildLedger(sessions)
    const stats = patternStats(ledger, 'WO-VF')
    expect(stats.count).toBe(2)
    expect(stats.rungs).toEqual([4, 2]) // oldest first — the trajectory reads correctly
    expect(stats.lastSeen).toBe('2026-07-28')
  })

  it('carries the session id and date onto each occurrence', () => {
    const ledger = buildLedger(sessions)
    expect(ledger['ADJ-END'].occurrences[0]).toMatchObject({
      sessionId: 's1',
      date: '2026-07-20',
      quote: 'deutsche Bücher',
      rung: 3,
    })
  })

  it('collects languaging notes', () => {
    expect(buildLedger(sessions)['WO-VF'].notes).toEqual([
      { date: '2026-07-20', text: 'verb last after weil' },
    ])
  })

  it('skips errors with no pattern code rather than crashing', () => {
    const ledger = buildLedger([{ id: 'x', date: '2026-07-30', errors: [{ quote: 'a' }, null] }])
    expect(ledger).toEqual({})
  })

  it('handles empty and missing input', () => {
    expect(buildLedger([])).toEqual({})
    expect(buildLedger(null)).toEqual({})
    expect(buildLedger([{ id: 'x', date: '2026-07-30' }])).toEqual({})
  })
})
