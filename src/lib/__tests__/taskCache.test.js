import { describe, it, expect } from 'vitest'
import { isTaskFresh, stampTask, TASK_TTL_HOURS } from '../taskCache'

const NOW = new Date('2026-07-30T12:00:00Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString()

describe('task cache', () => {
  it('keeps a task inside the TTL', () => {
    const task = { text: 'Write to Frau Berger.', generatedAt: hoursAgo(TASK_TTL_HOURS - 1) }
    expect(isTaskFresh(task, NOW)).toBe(true)
  })

  it('expires a task past the TTL', () => {
    const task = { text: 'Write to Frau Berger.', generatedAt: hoursAgo(TASK_TTL_HOURS + 1) }
    expect(isTaskFresh(task, NOW)).toBe(false)
  })

  it('treats missing, empty and untimestamped tasks as stale', () => {
    expect(isTaskFresh(null, NOW)).toBe(false)
    expect(isTaskFresh(undefined, NOW)).toBe(false)
    expect(isTaskFresh({ generatedAt: hoursAgo(1) }, NOW)).toBe(false)
    expect(isTaskFresh({ text: 'x' }, NOW)).toBe(false)
  })

  it('treats corrupt or future timestamps as stale rather than trusting them', () => {
    expect(isTaskFresh({ text: 'x', generatedAt: 'not a date' }, NOW)).toBe(false)
    expect(isTaskFresh({ text: 'x', generatedAt: hoursAgo(-5) }, NOW)).toBe(false)
  })

  it('stampTask records the time without disturbing the task', () => {
    const stamped = stampTask({ text: 'x', requirements: ['a'] }, NOW)
    expect(stamped.text).toBe('x')
    expect(stamped.requirements).toEqual(['a'])
    expect(stamped.generatedAt).toBe(NOW.toISOString())
    expect(isTaskFresh(stamped, NOW)).toBe(true)
  })
})
