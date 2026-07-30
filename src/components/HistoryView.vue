<script setup>
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'

const { state, deleteSession } = useStore()
const open = ref(null)
// Two-step, because deleting a session rewrites the ledger it fed.
const confirming = ref(null)

const sessions = computed(() => [...state.sessions].reverse())

function toggle(id) {
  open.value = open.value === id ? null : id
  confirming.value = null
}

async function remove(id) {
  confirming.value = null
  open.value = null
  await deleteSession(id)
}
</script>

<template>
  <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
    <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Sessions</p>
    <p v-if="!sessions.length" class="mt-3 text-sm text-stone-400">No sessions yet — write your first text.</p>
    <div v-for="s in sessions" :key="s.id" class="mt-3 rounded-lg border border-stone-200">
      <button class="flex w-full items-baseline gap-3 p-3 text-left hover:bg-stone-50" @click="toggle(s.id)">
        <span class="text-xs text-stone-400 tabular-nums">{{ s.date }}</span>
        <span class="flex-1 truncate text-sm">{{ s.promptText }}</span>
        <span v-if="s.pending" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">unsaved</span>
        <span class="text-xs text-stone-500">{{ s.errors.length }} error{{ s.errors.length === 1 ? '' : 's' }}</span>
      </button>
      <div v-if="open === s.id" class="border-t border-stone-200 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Final text</p>
        <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-relaxed">{{ s.finalText }}</p>
        <template v-if="s.draft !== s.finalText">
          <p class="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-400">First draft</p>
          <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-500">{{ s.draft }}</p>
        </template>

        <div class="mt-4 flex items-center justify-end gap-3 border-t border-stone-100 pt-3">
          <template v-if="confirming === s.id">
            <span class="text-xs text-stone-500">
              Delete this session? Its {{ s.errors.length }} occurrence{{ s.errors.length === 1 ? '' : 's' }}
              leave the ledger too.
            </span>
            <button class="text-xs text-stone-400 underline hover:text-stone-600" @click="confirming = null">
              Cancel
            </button>
            <button
              class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
              @click="remove(s.id)"
            >
              Delete
            </button>
          </template>
          <button
            v-else
            class="text-xs text-stone-400 underline hover:text-red-600"
            title="Use this when the engine graded badly — a wrong pattern code steers future tasks and your stage diagnosis."
            @click="confirming = s.id"
          >
            Delete session
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
