<script setup>
import { computed, onMounted, ref } from 'vue'
import { pickPrompt } from '../lib/prompts'
import { analyzeDraft, generateTask, hasEngine } from '../lib/engine'

import { normalizeLevel, levelDescriptor } from '../lib/level'
import { isTaskFresh } from '../lib/taskCache'
import { sessionPatternCodes } from '../lib/ledger'
import { patternFor } from '../lib/taxonomy'
import { rungTrajectory } from '../lib/ladder'
import { useStore } from '../composables/useStore'
import FeedbackPanel from './FeedbackPanel.vue'

const { state, completeSession, setCurrentTask, ceiling, todayStr } = useStore()
const level = computed(() => normalizeLevel(state.settings.cefrLevel))
const sentenceRange = computed(() => levelDescriptor(level.value).sentences)

// prompt → draft → feedback (draft + rewrite loop) → languaging → done
const step = ref('prompt')
const prompt = ref(null)
const taskBusy = ref(false)
const taskFellBack = ref('')
const fromCache = ref(false)
const draft = ref('')
const rewrite = ref('')
const praise = ref('')
const busy = ref(false)
const errorMsg = ref('')
const checkCount = ref(0)
// Which model actually answered — worth surfacing, since a session graded by
// the weaker fallback writes less trustworthy patterns into the ledger.
const analysisVia = ref('')
const gradedByFallback = ref(false)

// Working list: unresolved errors in the current rewrite, each { id, quote,
// sentenceIndex, patternCode, explanation, correction, revealedRung }.
const working = ref([])
// Errors already fixed (or conceded), with the rung that was needed.
const recorded = ref([])
// Languaging notes, patternCode → text.
const notes = ref({})

let nextId = 1
function toWorking(errors, prior = []) {
  return errors.map((e) => {
    // An identical span+pattern seen before keeps its revealed rung — the
    // learner shouldn't have to re-climb for the same unfixed error.
    const match = prior.find((p) => p.quote === e.quote && p.patternCode === e.patternCode)
    return { ...e, id: nextId++, revealedRung: match ? match.revealedRung : 1 }
  })
}

function bankPrompt() {
  return pickPrompt({
    activeTargets: state.settings.activeTargets,
    exclude: [...state.settings.recentPromptIds, prompt.value?.id].filter(Boolean),
  })
}

// A generated task carries explicit structural requirements aimed at the
// active targets; the static bank is the offline/failure fallback so the app
// still works without a key.
async function loadTask({ force = false } = {}) {
  taskFellBack.value = ''
  fromCache.value = false

  // Reuse the stored task unless it's stale or the learner asked for another.
  const cached = state.settings.currentTask
  if (!force && isTaskFresh(cached)) {
    prompt.value = cached
    fromCache.value = true
    return
  }

  if (!hasEngine) {
    prompt.value = bankPrompt()
    return
  }
  taskBusy.value = true
  const avoid = [
    ...(state.settings.recentPromptTexts || []),
    prompt.value?.text,
  ].filter(Boolean)
  try {
    prompt.value = await generateTask({
      activeTargets: state.settings.activeTargets,
      recentTasks: avoid.slice(0, 6),
      level: level.value,
      stageCeiling: ceiling.value,
    })
    setCurrentTask(prompt.value)
  } catch (e) {
    // Deliberately not cached: a stock prompt stored for 24h would suppress
    // retries long after a transient provider failure had cleared.
    prompt.value = bankPrompt()
    taskFellBack.value = e.message || 'unknown error'
  } finally {
    taskBusy.value = false
  }
}

function newTask() {
  loadTask({ force: true })
}

onMounted(() => loadTask())

async function getFeedback() {
  errorMsg.value = ''
  busy.value = true
  try {
    const analysis = await analyzeDraft(draft.value.trim(), { level: level.value })
    analysisVia.value = analysis.via
    gradedByFallback.value = analysis.fallback
    praise.value = analysis.praise
    if (analysis.clean) {
      working.value = []
      rewrite.value = draft.value.trim()
      step.value = 'languaging'
    } else {
      working.value = toWorking(analysis.errors)
      rewrite.value = draft.value.trim()
      checkCount.value = 0
      step.value = 'feedback'
    }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busy.value = false
  }
}

async function checkRewrite() {
  errorMsg.value = ''
  busy.value = true
  try {
    const analysis = await analyzeDraft(rewrite.value.trim(), { level: level.value })
    analysisVia.value = analysis.via
    gradedByFallback.value = analysis.fallback
    checkCount.value++
    // Old errors not re-flagged in the rewrite are resolved at their
    // current rung — that's the dynamic-assessment measure we keep.
    const still = analysis.errors
    for (const old of working.value) {
      const reFlagged = still.some(
        (n) => n.patternCode === old.patternCode && n.quote === old.quote
      )
      if (!reFlagged) {
        recorded.value.push({ quote: old.quote, patternCode: old.patternCode, rung: old.revealedRung })
      }
    }
    if (analysis.clean) {
      working.value = []
      step.value = 'languaging'
    } else {
      working.value = toWorking(still, working.value)
    }
    if (analysis.praise) praise.value = analysis.praise
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    busy.value = false
  }
}

function finishAnyway() {
  for (const old of working.value) {
    recorded.value.push({ quote: old.quote, patternCode: old.patternCode, rung: old.revealedRung, unresolved: true })
  }
  working.value = []
  step.value = 'languaging'
}

const sessionCodes = computed(() => sessionPatternCodes(recorded.value))

function finishSession() {
  completeSession({
    id: crypto.randomUUID(),
    date: todayStr(),
    promptId: prompt.value.id,
    promptText: prompt.value.text,
    promptRequirements: prompt.value.requirements || [],
    draft: draft.value.trim(),
    finalText: rewrite.value.trim(),
    checkCount: checkCount.value,
    gradedBy: analysisVia.value,
    errors: recorded.value,
    notes: notes.value,
  })
  step.value = 'done'
}

function newSession() {
  step.value = 'prompt'
  draft.value = ''
  rewrite.value = ''
  praise.value = ''
  working.value = []
  recorded.value = []
  notes.value = {}
  checkCount.value = 0
  errorMsg.value = ''
  analysisVia.value = ''
  gradedByFallback.value = false
  loadTask()
}

const wordCount = computed(() => draft.value.trim().split(/\s+/).filter(Boolean).length)
</script>

<template>
  <div class="space-y-4">
    <!-- Step: prompt -->
    <section v-if="step === 'prompt'" class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Today's task</p>

      <p v-if="taskBusy" class="mt-2 text-lg text-stone-400">Composing a task…</p>

      <template v-else-if="prompt">
        <p class="mt-2 text-lg">{{ prompt.text }}</p>

        <div v-if="prompt.requirements?.length" class="mt-3 rounded-lg bg-stone-50 px-3 py-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">It must</p>
          <ul class="mt-1 space-y-1">
            <li v-for="(r, i) in prompt.requirements" :key="i" class="flex gap-2 text-sm text-stone-600">
              <span class="text-stone-300">·</span><span>{{ r }}</span>
            </li>
          </ul>
        </div>

        <p class="mt-3 text-sm text-stone-500">
          Write it in German. Aim for {{ sentenceRange }} sentences, ~15 minutes.
          <span class="text-stone-400">· pitched at {{ level }}</span>
          <span v-if="fromCache" class="text-stone-400">· saved task</span>
        </p>
        <p v-if="taskFellBack" class="mt-1 text-xs text-amber-700">
          Couldn't reach the task generator — using a stock prompt. ({{ taskFellBack }})
        </p>

        <div class="mt-4 flex gap-2">
          <button class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" @click="step = 'draft'">
            Start writing
          </button>
          <button
            class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 disabled:opacity-50"
            :disabled="taskBusy"
            @click="newTask"
          >
            Different task
          </button>
        </div>
      </template>
    </section>

    <!-- Step: draft -->
    <section v-else-if="step === 'draft'" class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-sm text-stone-600">{{ prompt.text }}</p>
      <ul v-if="prompt.requirements?.length" class="mt-2 space-y-0.5">
        <li v-for="(r, i) in prompt.requirements" :key="i" class="flex gap-2 text-xs text-stone-500">
          <span class="text-stone-300">·</span><span>{{ r }}</span>
        </li>
      </ul>
      <textarea
        v-model="draft"
        rows="10"
        lang="de"
        class="mt-3 w-full rounded-lg border border-stone-300 p-3 font-serif text-base leading-relaxed focus:border-emerald-600 focus:outline-none"
        placeholder="Schreib hier auf Deutsch… (mark a form you're unsure about with a trailing ?, e.g. „dem? Mann“ — the feedback pass addresses those first)"
      ></textarea>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-xs text-stone-400">{{ wordCount }} words · no live correction, on purpose</span>
        <button
          class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          :disabled="busy || wordCount < 10"
          @click="getFeedback"
        >
          {{ busy ? 'Analyzing…' : 'Get feedback' }}
        </button>
      </div>
      <p v-if="errorMsg" class="mt-2 text-sm text-red-600">{{ errorMsg }}</p>
    </section>

    <!-- Step: feedback + rewrite loop -->
    <section v-else-if="step === 'feedback'" class="space-y-4">
      <p
        v-if="gradedByFallback"
        class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        Graded by <strong>{{ analysisVia }}</strong> — the primary model was unreachable. Treat the
        pattern codes with more suspicion than usual; they're going into your ledger.
      </p>

      <FeedbackPanel :errors="working" :text="rewrite" />

      <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Your rewrite</p>
        <p class="mt-1 text-sm text-stone-500">
          Fix the errors yourself — ask for more help on a card only when stuck. The session ends with a clean text.
        </p>
        <textarea
          v-model="rewrite"
          rows="10"
          lang="de"
          class="mt-3 w-full rounded-lg border border-stone-300 p-3 font-serif text-base leading-relaxed focus:border-emerald-600 focus:outline-none"
        ></textarea>
        <div class="mt-3 flex items-center justify-between">
          <button class="text-xs text-stone-400 underline hover:text-stone-600" @click="finishAnyway">
            Finish without a clean text
          </button>
          <button
            class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            :disabled="busy"
            @click="checkRewrite"
          >
            {{ busy ? 'Checking…' : 'Check rewrite' }}
          </button>
        </div>
        <p v-if="errorMsg" class="mt-2 text-sm text-red-600">{{ errorMsg }}</p>
      </div>
    </section>

    <!-- Step: languaging -->
    <section v-else-if="step === 'languaging'" class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">
        {{ sessionCodes.length ? 'One sentence per pattern' : 'Clean text!' }}
      </p>
      <p v-if="praise" class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ praise }}</p>

      <template v-if="sessionCodes.length">
        <p class="mt-2 text-sm text-stone-500">
          In your own words: what's the rule, and what will you watch for next time? (Writing it measurably helps — skip only if truly stuck.)
        </p>
        <div v-for="code in sessionCodes" :key="code" class="mt-4">
          <p class="text-sm font-medium">
            <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ code }}</span>
            {{ patternFor(code)?.name }}
          </p>
          <input
            v-model="notes[code]"
            type="text"
            class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            placeholder="e.g. after weil the conjugated verb goes last — scan every weil-clause before submitting"
          />
        </div>
      </template>
      <p v-else class="mt-2 text-sm text-stone-600">No errors to log — the session goes straight to the ledger.</p>

      <button class="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" @click="finishSession">
        Finish session
      </button>
    </section>

    <!-- Step: done -->
    <section v-else-if="step === 'done'" class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Session complete</p>
      <p class="mt-2 text-sm text-stone-600">
        {{ recorded.length ? `${recorded.length} error${recorded.length === 1 ? '' : 's'} worked through across ${checkCount} check${checkCount === 1 ? '' : 's'}.` : 'A clean first draft — logged.' }}
      </p>
      <ul v-if="recorded.length" class="mt-3 space-y-1 text-sm">
        <li v-for="(e, i) in recorded" :key="i" class="flex items-center gap-2">
          <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ e.patternCode }}</span>
          <span class="text-stone-600">„{{ e.quote }}“</span>
          <span class="ml-auto text-xs text-stone-400">help needed: {{ rungTrajectory([e.rung]) }}{{ e.unresolved ? ' · unresolved' : '' }}</span>
        </li>
      </ul>
      <button class="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" @click="newSession">
        New session
      </button>
    </section>
  </div>
</template>
