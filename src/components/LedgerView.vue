<script setup>
import { computed } from 'vue'
import { TAXONOMY, patternFor } from '../lib/taxonomy'
import { patternStats, suggestTargets, MAX_ACTIVE_TARGETS } from '../lib/ledger'
import { rungTrajectory } from '../lib/ladder'
import { useStore } from '../composables/useStore'
import { CEFR_LEVELS, levelDescriptor, normalizeLevel } from '../lib/level'
import { STAGE_NAMES, isAdmissible, admissibleCodes } from '../lib/stage'

const { state, setActiveTargets, setLevel, diagnosis, ceiling } = useStore()

const level = computed(() => normalizeLevel(state.settings.cefrLevel))
const levelInfo = computed(() => levelDescriptor(level.value))

const rows = computed(() =>
  TAXONOMY
    .map((p) => ({ ...p, stats: patternStats(state.ledger, p.code), notes: state.ledger[p.code]?.notes || [] }))
    .filter((r) => r.stats.count > 0)
    .sort((a, b) => b.stats.count - a.stats.count)
)

const targets = computed(() => state.settings.activeTargets)

function toggleTarget(code) {
  const cur = [...targets.value]
  const idx = cur.indexOf(code)
  if (idx !== -1) cur.splice(idx, 1)
  // Teachability: a structure above the ceiling can't be made a target, but an
  // existing one can always be removed.
  else if (cur.length < MAX_ACTIVE_TARGETS && isAdmissible(code, ceiling.value)) cur.push(code)
  setActiveTargets(cur)
}

function autoSuggest() {
  const allow = new Set(admissibleCodes(TAXONOMY.map((p) => p.code), ceiling.value))
  setActiveTargets(suggestTargets(state.ledger, { allow }))
}
</script>

<template>
  <div class="space-y-4">
    <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Level</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button
          v-for="l in CEFR_LEVELS"
          :key="l"
          class="rounded-lg border px-3 py-1.5 text-sm transition"
          :class="level === l
            ? 'border-emerald-600 bg-emerald-50 font-medium text-emerald-800'
            : 'border-stone-300 text-stone-500 hover:bg-stone-100'"
          @click="setLevel(l)"
        >
          {{ l }}
        </button>
      </div>
      <p class="mt-2 text-sm text-stone-500">
        {{ levelInfo.label }} — tasks are pitched here and reach one level up. Sets task demand and
        how strictly the analysis judges; you set it yourself, the app never assigns it.
      </p>

      <div class="mt-4 border-t border-stone-200 pt-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">
          Processability stage
        </p>
        <template v-if="diagnosis.stage != null">
          <p class="mt-1 text-sm">
            <span class="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
              stage {{ diagnosis.stage }}
            </span>
            <span class="ml-2 text-stone-600">{{ STAGE_NAMES[diagnosis.stage] }}</span>
          </p>
          <p class="mt-1 text-sm text-stone-500">
            Measured from your last 28 days ({{ diagnosis.evidence }} word-order
            error{{ diagnosis.evidence === 1 ? '' : 's' }}). Patterns up to
            <strong>stage {{ ceiling }}</strong> can be targeted — instruction sticks at your
            current stage plus one, so anything above is held back until this settles.
          </p>
        </template>
        <p v-else class="mt-1 text-sm text-stone-400">
          Not enough evidence yet — no stage-bound errors in the last 28 days, so no ceiling is
          applied. Case, adjective endings and tense are never gated; only word order is.
        </p>
        <p class="mt-2 text-xs text-stone-400">
          A heuristic: the ledger records errors, not correct sentences, so a quiet stage may mean
          you've acquired it or that you've been avoiding it.
        </p>
      </div>
    </section>

    <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <div class="flex items-baseline justify-between">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Active targets ({{ targets.length }}/{{ MAX_ACTIVE_TARGETS }})</p>
        <button class="text-xs text-emerald-700 underline hover:text-emerald-900" @click="autoSuggest">
          Suggest from recent errors
        </button>
      </div>
      <p class="mt-1 text-sm text-stone-500">
        Writing prompts are silently biased toward these patterns. At most {{ MAX_ACTIVE_TARGETS }} at a time — focused beats unfocused.
      </p>
      <div v-if="targets.length" class="mt-3 flex flex-wrap gap-2">
        <span v-for="code in targets" :key="code" class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900">
          {{ code }} · {{ patternFor(code)?.name }}
        </span>
      </div>
      <p v-else class="mt-3 text-sm text-stone-400">None yet — they'll suggest themselves once errors accumulate.</p>
    </section>

    <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Error patterns</p>
      <p v-if="!rows.length" class="mt-3 text-sm text-stone-400">
        Empty so far. Every error you work through in a session lands here as a pattern with its history.
      </p>
      <div v-for="row in rows" :key="row.code" class="mt-4 rounded-lg border border-stone-200 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ row.code }}</span>
          <span class="text-sm font-medium">{{ row.name }}</span>
          <span v-if="row.stage" class="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">stage {{ row.stage }}</span>
          <button
            v-if="targets.includes(row.code) || isAdmissible(row.code, ceiling)"
            class="ml-auto rounded border px-2 py-0.5 text-xs"
            :class="targets.includes(row.code)
              ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
              : 'border-stone-300 text-stone-500 hover:bg-stone-100'"
            @click="toggleTarget(row.code)"
          >
            {{ targets.includes(row.code) ? 'targeted' : 'target' }}
          </button>
          <span
            v-else
            class="ml-auto rounded border border-stone-200 px-2 py-0.5 text-xs text-stone-400"
            :title="`Above your current processability ceiling (stage ${ceiling}). It'll open up once stage ${diagnosis.stage} settles.`"
          >
            not yet
          </span>
        </div>
        <p class="mt-2 text-xs text-stone-500">
          {{ row.stats.count }}× · last {{ row.stats.lastSeen }} ·
          help trajectory {{ rungTrajectory(row.stats.rungs.slice(-6)) || '—' }}
          <span class="text-stone-400">(falling levels = internalizing)</span>
        </p>
        <ul v-if="row.notes.length" class="mt-2 space-y-1">
          <li v-for="(n, i) in row.notes.slice(-3)" :key="i" class="text-sm text-stone-600">
            <span class="text-stone-400">{{ n.date }}:</span> “{{ n.text }}”
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
