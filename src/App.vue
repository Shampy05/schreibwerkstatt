<script setup>
import { ref } from 'vue'
import SessionFlow from './components/SessionFlow.vue'
import LedgerView from './components/LedgerView.vue'
import HistoryView from './components/HistoryView.vue'
import AuthGate from './components/AuthGate.vue'
import { useAuth } from './composables/useAuth'

const { user, signedIn, signOut } = useAuth()

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
