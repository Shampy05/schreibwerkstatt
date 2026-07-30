import { computed, ref } from 'vue'
import { supabase, hasSupabase } from '../lib/supabase'

// Module singleton: one auth session shared by every consumer.
const session = ref(null)
const ready = ref(false)
let initialized = false

function init() {
  if (initialized) return
  initialized = true
  if (!hasSupabase) {
    ready.value = true
    return
  }
  supabase.auth.getSession().then(({ data }) => {
    session.value = data.session
    ready.value = true
  })
  supabase.auth.onAuthStateChange((_event, next) => {
    session.value = next
  })
}

export function useAuth() {
  init()

  const user = computed(() => session.value?.user || null)
  const userId = computed(() => user.value?.id || null)
  const signedIn = computed(() => Boolean(session.value))

  // BASE_URL keeps the magic link working under a GitHub Pages subpath
  // (/schreibwerkstatt/) as well as at the dev server root.
  function redirectTo() {
    return new URL(import.meta.env.BASE_URL, window.location.origin).href
  }

  async function signIn(email) {
    if (!hasSupabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    })
    if (error) throw new Error(error.message)
  }

  async function signOut() {
    if (!hasSupabase) return
    await supabase.auth.signOut()
  }

  return { session, user, userId, signedIn, ready, signIn, signOut }
}
