// Generated tasks are persisted and reused rather than regenerated on every
// mount. Without this, every page load — and in dev, every hot reload — fired a
// generation call, which is real money for a task the learner hasn't even
// started writing yet.
//
// A task is replaced when: the TTL expires, the learner asks for a different
// one, or the session using it is completed (see completeSession).

export const TASK_TTL_HOURS = 24

export function isTaskFresh(task, now = new Date()) {
  if (!task || !task.text || !task.generatedAt) return false
  const age = now.getTime() - new Date(task.generatedAt).getTime()
  // NaN = unparseable timestamp; negative = clock moved. Both mean "don't
  // trust it", and regenerating is the cheap, safe response.
  if (!Number.isFinite(age) || age < 0) return false
  return age < TASK_TTL_HOURS * 60 * 60 * 1000
}

export function stampTask(task, now = new Date()) {
  return { ...task, generatedAt: now.toISOString() }
}
