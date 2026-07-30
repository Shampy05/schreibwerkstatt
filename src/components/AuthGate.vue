<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { hasSupabase } from '../lib/supabase'

const { signedIn, ready, signIn } = useAuth()

const email = ref('')
const busy = ref(false)
const sent = ref(false)
const errorMsg = ref('')

async function submit() {
  errorMsg.value = ''
  busy.value = true
  try {
    await signIn(email.value)
    sent.value = true
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="!hasSupabase" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    <strong>Supabase isn't configured.</strong> Set <code>VITE_SUPABASE_URL</code> and
    <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>, then restart the dev server.
  </div>

  <p v-else-if="!ready" class="py-12 text-center text-sm text-stone-400">Checking your session…</p>

  <slot v-else-if="signedIn" />

  <section v-else class="mx-auto mt-10 max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
    <h2 class="text-lg font-semibold">Sign in</h2>
    <p class="mt-1 text-sm text-stone-500">
      Your sessions and error ledger are tied to your account. We'll email you a link — no password.
    </p>

    <template v-if="!sent">
      <form class="mt-4 space-y-3" @submit.prevent="submit">
        <input
          v-model="email"
          type="email"
          required
          autocomplete="email"
          placeholder="you@example.com"
          class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          class="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          :disabled="busy || !email"
        >
          {{ busy ? 'Sending…' : 'Email me a link' }}
        </button>
      </form>
      <p v-if="errorMsg" class="mt-2 text-sm text-red-600">{{ errorMsg }}</p>
    </template>

    <p v-else class="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      Link sent to <strong>{{ email }}</strong>. Open it on this device to finish signing in.
    </p>
  </section>
</template>
