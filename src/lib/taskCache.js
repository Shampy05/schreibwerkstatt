// Generated tasks are persisted and reused rather than regenerated on every
// mount. Without this, every page load — and in dev, every hot reload — fired a
// generation call, which is real money for a task the learner hasn't even
// started writing yet.
//
// A task is replaced when: the TTL expires, the inputs that shaped it change,
// the learner asks for a different one, or the session using it is completed
// (see completeSession).

export const TASK_TTL_HOURS = 24

// The inputs the generator was given. A cached task that outlives a change to
// its level or targets is worse than a regeneration: switching level in the
// Ledger tab appeared to do nothing at all for up to a day, because the task
// you went back to was the one generated under the old settings.
export function taskFingerprint({ level = null, targets = [] } = {}) {
  return `${level ?? ''}|${[...targets].sort().join(',')}`
}

export function stampTask(task, { now = new Date(), level, targets } = {}) {
  return {
    ...task,
    generatedAt: now.toISOString(),
    fingerprint: taskFingerprint({ level, targets }),
  }
}

export function isTaskFresh(task, { now = new Date(), level, targets } = {}) {
  if (!task || !task.text || !task.generatedAt) return false
  const age = now.getTime() - new Date(task.generatedAt).getTime()
  // NaN = unparseable timestamp; negative = clock moved. Both mean "don't
  // trust it", and regenerating is the cheap, safe response.
  if (!Number.isFinite(age) || age < 0) return false
  if (age >= TASK_TTL_HOURS * 60 * 60 * 1000) return false
  // Tasks stamped before fingerprinting existed carry none. Don't force a
  // regeneration on upgrade — the TTL retires them soon enough.
  if (task.fingerprint == null) return true
  return task.fingerprint === taskFingerprint({ level, targets })
}
