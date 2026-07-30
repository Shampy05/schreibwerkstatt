import { computed, reactive, ref, watch } from 'vue'
import {
  defaultState,
  loadCache,
  saveCache,
  sessionToRow,
  rowToSession,
  settingsToRow,
  rowToSettings,
  todayStr,
} from '../lib/store'
import { buildLedger, MAX_ACTIVE_TARGETS } from '../lib/ledger'
import { normalizeLevel } from '../lib/level'
import { diagnoseStage, stageCeiling } from '../lib/stage'
import { stampTask } from '../lib/taskCache'
import { supabase, hasSupabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Module singleton: one reactive state object shared by every view.
const state = reactive(defaultState())
const loading = ref(false)
const loadError = ref('')

let started = false
let currentUserId = null

function resetTo(next) {
  state.sessions = next.sessions
  state.settings = next.settings
  state.ledger = buildLedger(next.sessions)
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

    resetTo({
      sessions: (sessionsRes.data || []).map(rowToSession),
      settings: rowToSettings(settingsRes.data),
    })
    saveCache(userId, { sessions: state.sessions, settings: state.settings })
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
  if (error) loadError.value = `Couldn't save settings: ${error.message}`
}

export function useStore() {
  start()

  async function completeSession(session) {
    // Optimistic: the ledger rebuild is what the UI reacts to.
    state.sessions = [...state.sessions, session]
    state.ledger = buildLedger(state.sessions)

    const recentIds = [session.promptId, ...state.settings.recentPromptIds].filter(Boolean)
    state.settings.recentPromptIds = [...new Set(recentIds)].slice(0, 6)
    const recentTexts = [session.promptText, ...(state.settings.recentPromptTexts || [])].filter(Boolean)
    state.settings.recentPromptTexts = [...new Set(recentTexts)].slice(0, 6)
    // The task has been written; don't hand back the same one next session.
    state.settings.currentTask = null

    if (currentUserId && hasSupabase) {
      const { error } = await supabase.from('sessions').insert(sessionToRow(session, currentUserId))
      if (error) {
        loadError.value = `Couldn't save that session: ${error.message}`
      }
      await persistSettings()
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

  function setCurrentTask(task) {
    state.settings.currentTask = task ? stampTask(task) : null
    persistSettings()
  }

  // Derived, never stored — it must track the ledger, and a cached copy would
  // go stale the moment a session lands.
  const diagnosis = computed(() => diagnoseStage(state.ledger))
  const ceiling = computed(() => stageCeiling(diagnosis.value))

  return {
    state,
    loading,
    loadError,
    completeSession,
    setActiveTargets,
    setLevel,
    setCurrentTask,
    diagnosis,
    ceiling,
    todayStr,
  }
}
