// Persistence shapes. Supabase is the source of truth; localStorage is only a
// per-user cache so a reload paints instantly instead of waiting on the network.
//
// The mappers are pure and tested: JS camelCase <-> DB snake_case, the same
// split Garten uses. The ledger is absent from both sides on purpose — it is
// derived from sessions (buildLedger in ledger.js), so it can never disagree
// with the sessions that produced it.

export const STORAGE_PREFIX = 'schreibwerkstatt:v1'

export function cacheKey(userId) {
  return `${STORAGE_PREFIX}:${userId || 'anon'}`
}

export function defaultState() {
  return {
    sessions: [],       // completed sessions, oldest first
    ledger: {},         // derived; never persisted
    settings: {
      activeTargets: [],
      recentPromptIds: [],
      recentPromptTexts: [],
      cefrLevel: 'B1',
      currentTask: null,
    },
  }
}

export function loadCache(userId, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(cacheKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const base = defaultState()
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
    }
  } catch {
    return null
  }
}

export function saveCache(userId, state, storage = globalThis.localStorage) {
  try {
    storage.setItem(cacheKey(userId), JSON.stringify(state))
  } catch {
    /* quota or private mode — the cache is optional, Supabase still has it */
  }
}

export function todayStr(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- row mappers -----------------------------------------------------------

export function sessionToRow(session, userId) {
  return {
    user_id: userId,
    id: session.id,
    date: session.date,
    prompt_id: session.promptId ?? null,
    prompt_text: session.promptText ?? null,
    prompt_requirements: session.promptRequirements ?? [],
    draft: session.draft ?? '',
    final_text: session.finalText ?? '',
    check_count: session.checkCount ?? 0,
    graded_by: session.gradedBy ?? null,
    errors: session.errors ?? [],
    notes: session.notes ?? {},
  }
}

export function rowToSession(row) {
  return {
    id: row.id,
    date: row.date,
    promptId: row.prompt_id,
    promptText: row.prompt_text,
    promptRequirements: row.prompt_requirements ?? [],
    draft: row.draft ?? '',
    finalText: row.final_text ?? '',
    checkCount: row.check_count ?? 0,
    gradedBy: row.graded_by,
    errors: row.errors ?? [],
    notes: row.notes ?? {},
  }
}

export function settingsToRow(settings, userId) {
  return {
    user_id: userId,
    active_targets: settings.activeTargets ?? [],
    recent_prompt_ids: settings.recentPromptIds ?? [],
    recent_prompt_texts: settings.recentPromptTexts ?? [],
    cefr_level: settings.cefrLevel ?? 'B1',
    current_task: settings.currentTask ?? null,
    updated_at: new Date().toISOString(),
  }
}

export function rowToSettings(row) {
  const base = defaultState().settings
  if (!row) return base
  return {
    activeTargets: row.active_targets ?? base.activeTargets,
    recentPromptIds: row.recent_prompt_ids ?? base.recentPromptIds,
    recentPromptTexts: row.recent_prompt_texts ?? base.recentPromptTexts,
    cefrLevel: row.cefr_level ?? base.cefrLevel,
    currentTask: row.current_task ?? null,
  }
}
