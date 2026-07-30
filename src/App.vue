<script setup>
import { ref } from 'vue'
import SessionFlow from './components/SessionFlow.vue'
import LedgerView from './components/LedgerView.vue'
import HistoryView from './components/HistoryView.vue'
import AuthGate from './components/AuthGate.vue'
import { useAuth } from './composables/useAuth'
import { useStore } from './composables/useStore'

const { user, signedIn, signOut } = useAuth()
// Sync state is surfaced here, once, for every view. It used to be set in the
// store and rendered nowhere at all, which meant a failed save looked exactly
// like a successful one.
const { loading, loadError, syncError, pendingCount, reload, retryPending } = useStore()

const view = ref('write')
const TABS = [
  { key: 'write', label: 'Schreiben' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'history', label: 'Verlauf' },
]
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <header class="mb-6 flex items-end justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Schreibwerkstatt</h1>
        <p class="text-sm text-stone-500">Production practice for German — write, notice, rewrite.</p>
      </div>
      <nav v-if="signedIn" class="flex gap-1 rounded-lg bg-stone-200/70 p-1">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition"
          :class="view === tab.key ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-800'"
          @click="view = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <AuthGate>
      <div v-if="loadError" class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
        <p>Couldn't load your data — you may be looking at a stale copy. ({{ loadError }})</p>
        <button class="mt-1 text-xs underline hover:text-red-700" @click="reload">Try again</button>
      </div>

      <div
        v-else-if="syncError"
        class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        <p>{{ syncError }}</p>
        <button v-if="pendingCount" class="mt-1 text-xs underline hover:text-amber-700" @click="retryPending">
          Retry now ({{ pendingCount }} unsaved)
        </button>
      </div>

      <p v-else-if="loading" class="mb-4 text-xs text-stone-400">Loading your ledger…</p>

      <SessionFlow v-if="view === 'write'" />
      <LedgerView v-else-if="view === 'ledger'" />
      <HistoryView v-else />

      <footer class="mt-8 flex items-center justify-between text-xs text-stone-400">
        <span>{{ user?.email }}</span>
        <button class="underline hover:text-stone-600" @click="signOut">Sign out</button>
      </footer>
    </AuthGate>
  </div>
</template>
