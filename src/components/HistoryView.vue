<script setup>
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'

const { state } = useStore()
const open = ref(null)

const sessions = computed(() => [...state.sessions].reverse())

function toggle(id) {
  open.value = open.value === id ? null : id
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
        <span class="text-xs text-stone-500">{{ s.errors.length }} error{{ s.errors.length === 1 ? '' : 's' }}</span>
      </button>
      <div v-if="open === s.id" class="border-t border-stone-200 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Final text</p>
        <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-relaxed">{{ s.finalText }}</p>
        <template v-if="s.draft !== s.finalText">
          <p class="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-400">First draft</p>
          <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-500">{{ s.draft }}</p>
        </template>
      </div>
    </div>
  </section>
</template>
