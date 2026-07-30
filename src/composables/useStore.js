import { computed, reactive, ref, watch } from 'vue'
import {
  defaultState,
  loadCache,
  saveCache,
  mergeSessions,
  sessionToRow,
  rowToSession,
  settingsToRow,
  rowToSettings,
  todayStr,
} from '../lib/store'
import { buildLedger, MAX_ACTIVE_TARGETS } from '../lib/ledger'
import { isBankPrompt } from '../lib/prompts'
import { normalizeLevel } from '../lib/level'
import { diagnoseStage, stageCeiling } from '../lib/stage'
import { stampTask } from '../lib/taskCache'
import { supabase, hasSupabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Module singleton: one reactive state object shared by every view.
const state = reactive(defaultState())
const loading = ref(false)
const loadError = ref('')
// Write failures are their own signal: a load failure means "you're seeing
// stale data", a write failure means "your work is only on this device".
const syncError = ref('')

let started = false
let currentUserId = null

function resetTo(next) {
  state.sessions = next.sessions
  state.settings = next.settings
  state.ledger = buildLedger(next.sessions)
}

function markPending(id, pending) {
  state.sessions = state.sessions.map((s) => {
    if (s.id !== id) return s
    if (!pending) {
      const { pending: _drop, ...rest } = s
      return rest
    }
    return { ...s, pending: true }
  })
}

// Sessions whose insert failed are kept in memory and retried on every load,
// rather than being dropped on the floor with the learner none the wiser.
async function retryPending() {
  if (!currentUserId || !hasSupabase) return
  for (const session of state.sessions.filter((s) => s.pending)) {
    const { error } = await supabase.from('sessions').insert(sessionToRow(session, currentUserId))
    // 23505 = unique violation: the row landed after all, so it isn't pending.
    if (!error || error.code === '23505') markPending(session.id, false)
  }
  if (!state.sessions.some((s) => s.pending)) syncError.value = ''
}

async function loadFromSupabase(userId) {
  loading.value = true
  loadError.value = ''
  try {
    const [sessionsRes, settingsRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    ])
    if (sessionsRes.error) throw new Error(sessionsRes.error.message)
    if (settingsRes.error) throw new Error(settingsRes.error.message)

    // Merge rather than replace: a wholesale replace would discard — and then
    // re-cache over — any session the server never received.
    const server = (sessionsRes.data || []).map(rowToSession)
    resetTo({
      sessions: mergeSessions(server, state.sessions),
      settings: rowToSettings(settingsRes.data),
    })
    saveCache(userId, { sessions: state.sessions, settings: state.settings })
    retryPending()
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}

function start() {
  if (started) return
  started = true
  const { userId } = useAuth()

  watch(
    userId,
    (id) => {
      currentUserId = id
      loadError.value = ''
      syncError.value = ''
      if (!id) {
        resetTo(defaultState())
        return
      }
      // Paint from cache first, then reconcile against Supabase.
      const cached = loadCache(id)
      if (cached) resetTo(cached)
      if (hasSupabase) loadFromSupabase(id)
    },
    { immediate: true }
  )

  // Cache mirror only — real writes are explicit per mutation below, because a
  // deep watcher can't tell an insert from a load and would echo every fetch
  // straight back to the server.
  watch(
    () => [state.sessions, state.settings],
    () => {
      if (currentUserId) saveCache(currentUserId, { sessions: state.sessions, settings: state.settings })
    },
    { deep: true }
  )
}

async function persistSettings() {
  if (!currentUserId || !hasSupabase) return
  const { error } = await supabase
    .from('user_settings')
    .upsert(settingsToRow(state.settings, currentUserId), { onConflict: 'user_id' })
  if (error) syncError.value = `Couldn't save your settings: ${error.message}`
}

export function useStore() {
  start()

  async function completeSession(session) {
    // Optimistic: the ledger rebuild is what the UI reacts to.
    state.sessions = [...state.sessions, session]
    state.ledger = buildLedger(state.sessions)

    // Only bank ids belong here — it exists solely to keep `pickPrompt` from
    // repeating itself, and a generated task's id means nothing to the bank.
    // Filtering the whole list also flushes out ids stored before this fix.
    const recentIds = [session.promptId, ...state.settings.recentPromptIds].filter(isBankPrompt)
    state.settings.recentPromptIds = [...new Set(recentIds)].slice(0, 6)
    const recentTexts = [session.promptText, ...(state.settings.recentPromptTexts || [])].filter(Boolean)
    state.settings.recentPromptTexts = [...new Set(recentTexts)].slice(0, 6)
    // The task has been written; don't hand back the same one next session.
    state.settings.currentTask = null

    if (currentUserId && hasSupabase) {
      const { error } = await supabase.from('sessions').insert(sessionToRow(session, currentUserId))
      if (error) {
        // Never drop the work. Flag it, tell the learner, retry on next load.
        markPending(session.id, true)
        syncError.value = `That session is saved on this device but not to the server yet — ${error.message}`
      }
      await persistSettings()
    }
  }

  // A hallucinated pattern code is worse than a missing one: it writes a false
  // gap into the ledger, which then steers task generation and the stage
  // diagnosis. Removing the session that produced it is the escape hatch.
  async function deleteSession(id) {
    const before = state.sessions
    state.sessions = state.sessions.filter((s) => s.id !== id)
    state.ledger = buildLedger(state.sessions)
    if (currentUserId && hasSupabase) {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('user_id', currentUserId)
        .eq('id', id)
      if (error) {
        resetTo({ sessions: before, settings: state.settings })
        syncError.value = `Couldn't delete that session: ${error.message}`
      }
    }
  }

  function setActiveTargets(codes) {
    state.settings.activeTargets = codes.slice(0, MAX_ACTIVE_TARGETS)
    persistSettings()
  }

  function setLevel(level) {
    state.settings.cefrLevel = normalizeLevel(level)
    persistSettings()
  }

  // Stamped with the level and targets it was generated under, so a change to
  // either retires it instead of leaving a task pitched at the old settings.
  function setCurrentTask(task) {
    state.settings.currentTask = task
      ? stampTask(task, {
          level: normalizeLevel(state.settings.cefrLevel),
          targets: state.settings.activeTargets,
        })
      : null
    persistSettings()
  }

  function reload() {
    if (currentUserId && hasSupabase) loadFromSupabase(currentUserId)
  }

  // Derived, never stored — it must track the ledger, and a cached copy would
  // go stale the moment a session lands.
  const diagnosis = computed(() => diagnoseStage(state.ledger))
  const ceiling = computed(() => stageCeiling(diagnosis.value))
  const pendingCount = computed(() => state.sessions.filter((s) => s.pending).length)

  return {
    state,
    loading,
    loadError,
    syncError,
    pendingCount,
    completeSession,
    deleteSession,
    setActiveTargets,
    setLevel,
    setCurrentTask,
    reload,
    retryPending,
    diagnosis,
    ceiling,
    todayStr,
  }
}
