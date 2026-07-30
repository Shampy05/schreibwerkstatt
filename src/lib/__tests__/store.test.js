import { describe, it, expect } from 'vitest'
import {
  sessionToRow,
  rowToSession,
  settingsToRow,
  rowToSettings,
  defaultState,
  cacheKey,
} from '../store'

const session = {
  id: 'abc',
  date: '2026-07-30',
  promptId: 'gen-1',
  promptText: 'Write to Frau Berger about her parrot.',
  promptRequirements: ['two reasons with weil'],
  draft: 'erste Fassung',
  finalText: 'saubere Fassung',
  checkCount: 2,
  gradedBy: 'claude-opus-5',
  errors: [{ quote: 'weil es ist', patternCode: 'WO-VF', rung: 3 }],
  notes: { 'WO-VF': 'verb goes last after weil' },
}

describe('row mappers', () => {
  it('round-trips a session without loss', () => {
    expect(rowToSession(sessionToRow(session, 'user-1'))).toEqual(session)
  })

  it('scopes the row to the user', () => {
    expect(sessionToRow(session, 'user-1').user_id).toBe('user-1')
  })

  it('fills defaults for a sparse session', () => {
    const row = sessionToRow({ id: 'x', date: '2026-07-30' }, 'u')
    expect(row.errors).toEqual([])
    expect(row.notes).toEqual({})
    expect(row.check_count).toBe(0)
    expect(row.prompt_requirements).toEqual([])
  })

  it('round-trips settings', () => {
    const settings = {
      activeTargets: ['WO-VF'],
      recentPromptIds: ['gen-1'],
      recentPromptTexts: ['Write to Frau Berger.'],
      cefrLevel: 'B2',
      currentTask: { text: 'x', generatedAt: '2026-07-30T00:00:00.000Z' },
    }
    expect(rowToSettings(settingsToRow(settings, 'u'))).toEqual(settings)
  })

  it('falls back to defaults when no settings row exists', () => {
    expect(rowToSettings(null)).toEqual(defaultState().settings)
    expect(rowToSettings(undefined).cefrLevel).toBe('B1')
  })

  it('keys the cache per user so two accounts never collide', () => {
    expect(cacheKey('a')).not.toBe(cacheKey('b'))
    expect(cacheKey(null)).toContain('anon')
  })
})
