<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { pickPrompt } from '../lib/prompts'
import { analyzeDraft, generateTask, hasEngine } from '../lib/engine'

import { normalizeLevel, levelDescriptor } from '../lib/level'
import { isTaskFresh } from '../lib/taskCache'
import { sessionPatternCodes } from '../lib/ledger'
import { matchError, isSameAsAny, resolveWorking } from '../lib/errorMatch'
import { loadDraft, saveDraft, clearDraft } from '../lib/store'
import { findHypothesisMarks, removeMarkAt, removeAllMarks } from '../lib/hypothesisMarks'
import { patternFor } from '../lib/taxonomy'
import { rungTrajectory } from '../lib/ladder'
import { useStore } from '../composables/useStore'
import { useAuth } from '../composables/useAuth'
import FeedbackPanel from './FeedbackPanel.vue'

const { state, completeSession, setCurrentTask, ceiling, todayStr } = useStore()
const { userId } = useAuth()
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
// The text the errors were located against. Frozen at analysis time: rung 1 is
// nothing but a sentence number, and pointing it at the live rewrite made that
// number drift — and therefore lie — the moment a sentence was added or cut.
const analyzedText = ref('')
// Errors the learner has rejected, as { quote, patternCode }. Kept for the rest
// of the session so re-checking a rewrite doesn't resurrect them.
const dismissed = ref([])

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
    // The same error seen before keeps its revealed rung — the learner
    // shouldn't have to re-climb for something they haven't fixed yet. Matched
    // on code + overlapping span, not an identical quote: a re-quote with
    // different boundaries is the same error, and treating it as a new one
    // threw away the rung history.
    const match = matchError(e, prior)
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
  // "Stale" includes a level or target change since it was generated — keeping
  // it would silently ignore the setting the learner just changed.
  const cached = state.settings.currentTask
  if (
    !force &&
    isTaskFresh(cached, { level: level.value, targets: state.settings.activeTargets })
  ) {
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

// --- in-progress session autosave -------------------------------------------
//
// A draft used to live only in these refs, so closing the tab twelve minutes
// into a fifteen-minute session threw the text away. Local only — an unfinished
// session is scratch work and has no business on the server.

function snapshot() {
  return {
    step: step.value,
    prompt: prompt.value,
    draft: draft.value,
    rewrite: rewrite.value,
    praise: praise.value,
    checkCount: checkCount.value,
    analysisVia: analysisVia.value,
    gradedByFallback: gradedByFallback.value,
    analyzedText: analyzedText.value,
    working: working.value,
    recorded: recorded.value,
    notes: notes.value,
    dismissed: dismissed.value,
    nextId,
  }
}

function restore(snap) {
  step.value = snap.step || 'draft'
  prompt.value = snap.prompt || null
  draft.value = snap.draft || ''
  rewrite.value = snap.rewrite || ''
  praise.value = snap.praise || ''
  checkCount.value = snap.checkCount || 0
  analysisVia.value = snap.analysisVia || ''
  gradedByFallback.value = Boolean(snap.gradedByFallback)
  analyzedText.value = snap.analyzedText || ''
  working.value = snap.working || []
  recorded.value = snap.recorded || []
  notes.value = snap.notes || {}
  dismissed.value = snap.dismissed || []
  // Ids must not collide with the restored cards' ids.
  nextId = Math.max(snap.nextId || 1, ...working.value.map((w) => w.id + 1), 1)
}

let saveTimer = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (step.value === 'prompt' || step.value === 'done') return
    saveDraft(userId.value, snapshot())
  }, 400)
}

function discardDraft() {
  if (saveTimer) clearTimeout(saveTimer)
  clearDraft(userId.value)
}

watch(
  [step, draft, rewrite, working, recorded, notes, dismissed],
  () => scheduleSave(),
  { deep: true }
)

onMounted(() => {
  const saved = loadDraft(userId.value)
  if (saved && saved.prompt) {
    restore(saved)
    return
  }
  loadTask()
})

// An error the learner has already rejected must not come back on the next
// check — the whole point of rejecting it was to keep it out of the ledger.
function keepable(errors) {
  return errors.filter((e) => !isSameAsAny(e, dismissed.value))
}

async function getFeedback() {
  errorMsg.value = ''
  busy.value = true
  const text = draft.value.trim()
  try {
    const analysis = await analyzeDraft(text, { level: level.value })
    analysisVia.value = analysis.via
    gradedByFallback.value = analysis.fallback
    praise.value = analysis.praise
    analyzedText.value = text
    rewrite.value = text
    const errors = keepable(analysis.errors)
    if (analysis.clean || !errors.length) {
      working.value = []
      step.value = 'languaging'
    } else {
      working.value = toWorking(errors)
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
  const text = rewrite.value.trim()
  try {
    const analysis = await analyzeDraft(text, { level: level.value })
    analysisVia.value = analysis.via
    gradedByFallback.value = analysis.fallback
    analyzedText.value = text
    checkCount.value++
    const still = keepable(analysis.errors)
    // Old errors not re-flagged in the rewrite are resolved at their
    // current rung — that's the dynamic-assessment measure we keep.
    recorded.value = [...recorded.value, ...resolveWorking(working.value, still)]
    if (analysis.clean || !still.length) {
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

// Rejecting an engine error drops it without recording an occurrence: it never
// happened as far as the ledger is concerned. That matters because a wrong
// pattern code steers task generation and the stage diagnosis.
function dismissError(err) {
  dismissed.value = [...dismissed.value, { quote: err.quote, patternCode: err.patternCode }]
  working.value = working.value.filter((w) => w.id !== err.id)
}

function finishAnyway() {
  for (const old of working.value) {
    recorded.value.push({ quote: old.quote, patternCode: old.patternCode, rung: old.revealedRung, unresolved: true })
  }
  working.value = []
  step.value = 'languaging'
}

const sessionCodes = computed(() => sessionPatternCodes(recorded.value))

// The final text shouldn't carry the scaffolding you wrote to think with. Not
// auto-stripped: a real question mark is indistinguishable by rule, so each one
// is offered individually and you decide.
const marks = computed(() => findHypothesisMarks(rewrite.value))

function clearMark(index) {
  rewrite.value = removeMarkAt(rewrite.value, index)
}

function clearAllMarks() {
  rewrite.value = removeAllMarks(rewrite.value)
}

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
  discardDraft()
  step.value = 'done'
}

function newSession() {
  discardDraft()
  step.value = 'prompt'
  draft.value = ''
  rewrite.value = ''
  praise.value = ''
  working.value = []
  recorded.value = []
  notes.value = {}
  dismissed.value = []
  checkCount.value = 0
  errorMsg.value = ''
  analysisVia.value = ''
  gradedByFallback.value = false
  analyzedText.value = ''
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

        <details v-if="prompt.glossary?.length" class="mt-3">
          <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-400 hover:text-stone-600">
            Words you might need ({{ prompt.glossary.length }})
          </summary>
          <dl class="mt-2 space-y-1">
            <div v-for="(g, i) in prompt.glossary" :key="i" class="flex flex-wrap gap-x-2 text-sm">
              <dt lang="de" class="font-medium text-stone-700">{{ g.de }}</dt>
              <dd class="text-stone-500">— {{ g.en }}</dd>
            </div>
          </dl>
          <p class="mt-1.5 text-xs text-stone-400">
            Dictionary forms. The endings are yours to work out.
          </p>
        </details>

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
      <details v-if="prompt.glossary?.length" class="mt-2">
        <summary class="cursor-pointer text-xs text-stone-400 hover:text-stone-600">
          Words you might need ({{ prompt.glossary.length }})
        </summary>
        <dl class="mt-1.5 space-y-0.5">
          <div v-for="(g, i) in prompt.glossary" :key="i" class="flex flex-wrap gap-x-2 text-sm">
            <dt lang="de" class="font-medium text-stone-700">{{ g.de }}</dt>
            <dd class="text-stone-500">— {{ g.en }}</dd>
          </div>
        </dl>
      </details>
      <textarea
        v-model="draft"
        rows="10"
        lang="de"
        class="mt-3 w-full rounded-lg border border-stone-300 p-3 font-serif text-base leading-relaxed focus:border-emerald-600 focus:outline-none"
        placeholder="Schreib hier auf Deutsch… (mark a form you're unsure about with a trailing ?, e.g. „dem? Mann“ — the feedback pass addresses those first)"
      ></textarea>
      <div class="mt-3 flex items-center justify-between gap-3">
        <span class="text-xs text-stone-400">
          {{ wordCount }} words · no live correction, on purpose ·
          <button class="underline hover:text-stone-600" @click="newSession">start over</button>
        </span>
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
        Graded by <strong>{{ analysisVia }}</strong> — your first-choice model was unreachable. Treat
        the pattern codes with more suspicion than usual; they're going into your ledger.
      </p>
      <p v-else-if="analysisVia" class="px-1 text-xs text-stone-400">
        Graded by {{ analysisVia }}
      </p>

      <FeedbackPanel :errors="working" :text="analyzedText" @dismiss="dismissError" />

      <p v-if="!working.length" class="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-500">
        Every card dismissed. Check the rewrite to confirm the text is clean — the dismissed ones
        won't come back.
      </p>

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

      <div v-if="marks.length" class="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
        <p class="text-xs text-amber-900">
          Your text still has {{ marks.length }} “?”. Remove any that were hypothesis marks —
          the session is meant to end in a clean text. Real questions can stay.
        </p>
        <ul class="mt-2 space-y-1">
          <li v-for="m in marks" :key="m.index" class="flex items-center gap-2 text-sm">
            <span lang="de" class="truncate font-serif text-stone-700">
              …{{ m.before }}<span class="text-amber-700">{{ m.after }}</span>…
            </span>
            <button
              class="ml-auto shrink-0 rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
              @click="clearMark(m.index)"
            >
              remove
            </button>
          </li>
        </ul>
        <button
          v-if="marks.length > 1"
          class="mt-2 text-xs text-amber-900 underline hover:text-amber-700"
          @click="clearAllMarks"
        >
          None of these are real questions — remove all
        </button>
      </div>

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
