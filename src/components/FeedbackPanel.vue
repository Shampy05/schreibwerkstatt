<script setup>
// One card per unresolved error. Everything the engine knows is already on
// the error object; this component's whole job is to NOT show it — each
// card reveals exactly one more rung when asked (elicitation before
// explanation before correction, never recast-first).
import { computed } from 'vue'
import { MAX_RUNG, rungLabel, nextRung } from '../lib/ladder'
import { patternFor } from '../lib/taxonomy'
import { splitSentences } from '../lib/engine'

const props = defineProps({
  errors: { type: Array, required: true },
  text: { type: String, required: true },
})

const sentences = computed(() => splitSentences(props.text))

function sentenceLabel(err) {
  const n = err.sentenceIndex + 1
  return n <= sentences.value.length ? `Sentence ${n}` : 'One sentence'
}

function reveal(err) {
  const next = nextRung(err.revealedRung)
  if (next) err.revealedRung = next
}
</script>

<template>
  <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
    <div class="flex items-baseline justify-between">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">
        Feedback — {{ errors.length }} to work through
      </p>
      <p class="text-xs text-stone-400">help escalates only when you ask</p>
    </div>

    <div class="mt-3 space-y-3">
      <div
        v-for="err in errors"
        :key="err.id"
        class="rounded-lg border border-stone-200 bg-stone-50 p-4"
      >
        <!-- Rung 1: locate -->
        <p class="text-sm font-medium text-stone-800">
          {{ sentenceLabel(err) }} contains an error.
        </p>

        <!-- Rung 2: the span -->
        <p v-if="err.revealedRung >= 2" class="mt-2 text-sm">
          <span class="rounded bg-amber-100 px-1 underline decoration-amber-500 decoration-wavy underline-offset-4">{{ err.quote }}</span>
        </p>

        <!-- Rung 3: pattern code -->
        <p v-if="err.revealedRung >= 3" class="mt-2 text-sm">
          <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ err.patternCode }}</span>
          <span class="ml-1 text-stone-600">{{ patternFor(err.patternCode)?.name }}</span>
        </p>

        <!-- Rung 4: metalinguistic explanation -->
        <p v-if="err.revealedRung >= 4" class="mt-2 text-sm text-stone-700">
          {{ err.explanation }}
        </p>

        <!-- Rung 5: the correction -->
        <p v-if="err.revealedRung >= 5" class="mt-2 text-sm">
          <span class="rounded bg-emerald-100 px-1 font-medium text-emerald-900">{{ err.correction }}</span>
        </p>

        <div class="mt-3 flex items-center justify-between">
          <span class="text-xs text-stone-400">help level {{ err.revealedRung }}/{{ MAX_RUNG }}</span>
          <button
            v-if="err.revealedRung < MAX_RUNG"
            class="rounded border border-stone-300 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-100"
            @click="reveal(err)"
          >
            {{ rungLabel(err.revealedRung + 1) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
