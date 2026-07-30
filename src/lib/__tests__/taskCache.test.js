import { describe, it, expect } from 'vitest'
import { isTaskFresh, stampTask, taskFingerprint, TASK_TTL_HOURS } from '../taskCache'

const NOW = new Date('2026-07-30T12:00:00Z')
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString()
const at = (extra = {}) => ({ now: NOW, ...extra })

describe('task cache', () => {
  it('keeps a task inside the TTL', () => {
    const task = { text: 'Write to Frau Berger.', generatedAt: hoursAgo(TASK_TTL_HOURS - 1) }
    expect(isTaskFresh(task, at())).toBe(true)
  })

  it('expires a task past the TTL', () => {
    const task = { text: 'Write to Frau Berger.', generatedAt: hoursAgo(TASK_TTL_HOURS + 1) }
    expect(isTaskFresh(task, at())).toBe(false)
  })

  it('treats missing, empty and untimestamped tasks as stale', () => {
    expect(isTaskFresh(null, at())).toBe(false)
    expect(isTaskFresh(undefined, at())).toBe(false)
    expect(isTaskFresh({ generatedAt: hoursAgo(1) }, at())).toBe(false)
    expect(isTaskFresh({ text: 'x' }, at())).toBe(false)
  })

  it('treats corrupt or future timestamps as stale rather than trusting them', () => {
    expect(isTaskFresh({ text: 'x', generatedAt: 'not a date' }, at())).toBe(false)
    expect(isTaskFresh({ text: 'x', generatedAt: hoursAgo(-5) }, at())).toBe(false)
  })

  it('stampTask records the time without disturbing the task', () => {
    const stamped = stampTask({ text: 'x', requirements: ['a'] }, at())
    expect(stamped.text).toBe('x')
    expect(stamped.requirements).toEqual(['a'])
    expect(stamped.generatedAt).toBe(NOW.toISOString())
    expect(isTaskFresh(stamped, at())).toBe(true)
  })
})

describe('task fingerprint', () => {
  const context = { level: 'B1', targets: ['WO-VF', 'KAS-DAT'] }

  it('is order-insensitive about targets', () => {
    expect(taskFingerprint({ level: 'B1', targets: ['a', 'b'] })).toBe(
      taskFingerprint({ level: 'B1', targets: ['b', 'a'] })
    )
  })

  it('keeps a task generated under the same level and targets', () => {
    const task = stampTask({ text: 'x' }, at(context))
    expect(isTaskFresh(task, at(context))).toBe(true)
  })

  it('retires a task when the level changes', () => {
    const task = stampTask({ text: 'x' }, at(context))
    expect(isTaskFresh(task, at({ ...context, level: 'B2' }))).toBe(false)
  })

  it('retires a task when the active targets change', () => {
    const task = stampTask({ text: 'x' }, at(context))
    expect(isTaskFresh(task, at({ ...context, targets: ['WO-V2'] }))).toBe(false)
    expect(isTaskFresh(task, at({ ...context, targets: [] }))).toBe(false)
  })

  it('does not force a regeneration for tasks stamped before fingerprinting existed', () => {
    const legacy = { text: 'x', generatedAt: hoursAgo(1) }
    expect(isTaskFresh(legacy, at(context))).toBe(true)
  })
})
