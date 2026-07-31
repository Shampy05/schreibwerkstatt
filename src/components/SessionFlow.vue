<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { pickPrompt } from '../lib/prompts'
import { analyzeDraft, generateTask, hasEngine } from '../lib/engine'

import { normalizeLevel, levelDescriptor } from '../lib/level'
import { isTaskFresh } from '../lib/taskCache'
import { MAX_ACTIVE_TARGETS } from '../lib/ledger'
import { matchError, isSameAsAny, resolveWorking } from '../lib/errorMatch'
import { loadDraft, saveDraft, clearDraft } from '../lib/store'
import { findHypothesisMarks, removeMarkAt, removeAllMarks } from '../lib/hypothesisMarks'
import { patternFor } from '../lib/taxonomy'
import { buildReview, promotionCandidate } from '../lib/review'
import { rungLabel } from '../lib/ladder'
import { useStore } from '../composables/useStore'
import { useAuth } from '../composables/useAuth'
import FeedbackPanel from './FeedbackPanel.vue'

const { state, completeSession, setCurrentTask, setActiveTargets, ceiling, todayStr } = useStore()
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
// Praise for the FIRST draft only, and never overwritten by a later check.
// Re-analysing the corrected text and praising that congratulates the learner
// for corrections the engine handed them; the unaided draft is the only text
// they actually produced.
const draftPraise = ref('')
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
// Patterns the learner explicitly passed on. A blank box is ambiguous — it
// could mean "nothing to say" or "I'll get to it"; a skip is an answer.
const skipped = ref([])
// The remaining patterns' note fields, revealed on request.
const showAllNotes = ref(false)
// The review is frozen when the session reaches this step. It reads the ledger
// as it stands BEFORE this session lands — which is what makes "3rd time" mean
// three previous times — and completeSession rebuilds that ledger underneath us.
const review = ref({ fixes: [], patterns: [] })
// Set when a pattern is promoted to an active target from the done screen, so
// the offer can be replaced by a confirmation instead of silently vanishing.
const promoted = ref('')

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
    draftPraise: draftPraise.value,
    checkCount: checkCount.value,
    analysisVia: analysisVia.value,
    gradedByFallback: gradedByFallback.value,
    analyzedText: analyzedText.value,
    working: working.value,
    recorded: recorded.value,
    notes: notes.value,
    skipped: skipped.value,
    review: review.value,
    dismissed: dismissed.value,
    nextId,
  }
}

function restore(snap) {
  step.value = snap.step || 'draft'
  prompt.value = snap.prompt || null
  draft.value = snap.draft || ''
  rewrite.value = snap.rewrite || ''
  draftPraise.value = snap.draftPraise || ''
  checkCount.value = snap.checkCount || 0
  analysisVia.value = snap.analysisVia || ''
  gradedByFallback.value = Boolean(snap.gradedByFallback)
  analyzedText.value = snap.analyzedText || ''
  working.value = snap.working || []
  recorded.value = snap.recorded || []
  notes.value = snap.notes || {}
  skipped.value = snap.skipped || []
  // Recomputed rather than trusted if it's missing: an autosave written before
  // this step existed has no review, and the ledger hasn't moved since.
  review.value = snap.review || makeReview()
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
  [step, draft, rewrite, working, recorded, notes, skipped, dismissed],
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

// Freeze what the session amounted to, against the pre-session ledger.
function makeReview() {
  return buildReview({
    recorded: recorded.value,
    ledger: state.ledger,
    activeTargets: state.settings.activeTargets,
  })
}

function enterReview() {
  review.value = makeReview()
  step.value = 'languaging'
}

async function getFeedback() {
  errorMsg.value = ''
  busy.value = true
  const text = draft.value.trim()
  try {
    const analysis = await analyzeDraft(text, { level: level.value })
    analysisVia.value = analysis.via
    gradedByFallback.value = analysis.fallback
    draftPraise.value = analysis.praise
    analyzedText.value = text
    rewrite.value = text
    const errors = keepable(analysis.errors)
    if (analysis.clean || !errors.length) {
      working.value = []
      enterReview()
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
      enterReview()
    } else {
      working.value = toWorking(still, working.value)
    }
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
    recorded.value.push({
      quote: old.quote,
      patternCode: old.patternCode,
      rung: old.revealedRung,
      unresolved: true,
      ...(old.correction ? { correction: old.correction } : {}),
    })
  }
  working.value = []
  enterReview()
}

// The patterns whose note field is showing: the ranked top few, plus everything
// else once the learner asks for it. Asking for a note on every code contradicts
// the focused-WCF stance the ledger already takes when it caps active targets.
const askedPatterns = computed(() =>
  showAllNotes.value ? review.value.patterns : review.value.patterns.filter((p) => p.askForNote)
)
const quietPatterns = computed(() => review.value.patterns.filter((p) => !p.askForNote))

function skipNote(code) {
  if (!skipped.value.includes(code)) skipped.value = [...skipped.value, code]
  delete notes.value[code]
}

function unskipNote(code) {
  skipped.value = skipped.value.filter((c) => c !== code)
}

// Offered only once the session has landed, so the count it's based on includes
// today. Recomputes off live settings, so promoting makes the offer disappear.
const promotable = computed(() =>
  promotionCandidate(review.value.patterns, {
    activeTargets: state.settings.activeTargets,
    ceiling: ceiling.value,
    max: MAX_ACTIVE_TARGETS,
  })
)

function promote(code) {
  promoted.value = code
  setActiveTargets([...state.settings.activeTargets, code])
}

// "help L2", not "L2 · Show me where" — in a recap the ladder's own imperative
// labels read as instructions rather than as how much help was needed, and the
// bare level is the idiom the ledger's trajectories already use.
function helpLabel(rung) {
  return rung ? `help L${rung}` : ''
}

function helpTitle(rung) {
  return rung ? `Rung ${rung} — ${rungLabel(rung)}` : ''
}

const writtenNotes = computed(() =>
  Object.entries(notes.value).filter(([, text]) => (text || '').trim())
)

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
  draftPraise.value = ''
  working.value = []
  recorded.value = []
  notes.value = {}
  skipped.value = []
  showAllNotes.value = false
  review.value = { fixes: [], patterns: [] }
  promoted.value = ''
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

    <!-- Step: review (recap → reflect → commit, in that order) -->
    <div v-else-if="step === 'languaging'" class="space-y-4">
      <!-- Cleaning the hypothesis marks gates the clean text, so it comes first. -->
      <section v-if="marks.length" class="rounded-xl border border-amber-300 bg-amber-50 p-4">
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
      </section>

      <!-- Band 1: what the session actually produced -->
      <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Session review</p>

        <div v-if="draftPraise" class="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
          <p class="text-sm text-emerald-800">{{ draftPraise }}</p>
          <p class="mt-1 text-xs text-emerald-700/70">— on your first draft, before any feedback.</p>
        </div>

        <template v-if="review.fixes.length">
          <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-stone-400">
            What you closed — {{ review.fixes.length }} across
            {{ checkCount }} check{{ checkCount === 1 ? '' : 's' }}
          </p>
          <ul class="mt-1 divide-y divide-stone-100">
            <li v-for="(f, i) in review.fixes" :key="i" class="flex flex-wrap items-baseline gap-x-2 py-2">
              <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ f.patternCode }}</span>
              <span
                lang="de"
                class="font-serif text-sm underline decoration-amber-500 decoration-wavy underline-offset-4"
              >{{ f.quote }}</span>
              <template v-if="f.correction">
                <span class="text-stone-300">→</span>
                <span lang="de" class="font-serif text-sm font-medium text-emerald-900">{{ f.correction }}</span>
              </template>
              <span class="ml-auto shrink-0 text-xs text-stone-400" :title="helpTitle(f.rung)">
                {{ helpLabel(f.rung) }}<span v-if="f.unresolved" class="text-amber-700"> · left unfixed</span>
              </span>
            </li>
          </ul>
        </template>
        <p v-else class="mt-3 text-sm text-stone-600">A clean first draft — nothing to work through.</p>
      </section>

      <!-- Band 2: the one or two patterns worth a sentence -->
      <section class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <template v-if="review.patterns.length">
          <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Worth writing down</p>
          <p class="mt-1 text-sm text-stone-500">
            One sentence in your own words. Writing it measurably helps — and only the patterns that
            cost you the most help are asked about, because a wall of empty boxes gets none of them
            filled.
          </p>

          <div v-for="p in askedPatterns" :key="p.code" class="mt-4 rounded-lg border border-stone-200 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ p.code }}</span>
              <span class="text-sm font-medium">{{ p.name }}</span>
              <span v-if="p.isTarget" class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
                active target
              </span>
              <span v-if="p.unresolved" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                still unfixed
              </span>
            </div>

            <ul class="mt-2 space-y-0.5">
              <li v-for="(o, i) in p.occurrences" :key="i" class="text-sm">
                <span lang="de" class="font-serif text-stone-700">„{{ o.quote }}“</span>
                <template v-if="o.correction">
                  <span class="text-stone-300"> → </span>
                  <span lang="de" class="font-serif text-emerald-900">{{ o.correction }}</span>
                </template>
              </li>
            </ul>

            <p v-if="p.priorCount" class="mt-2 text-xs text-stone-500">
              Seen {{ p.priorCount }}× before · help {{ p.priorTrajectory || '—' }} · last
              {{ p.priorLastSeen }}
              <!-- A single prior rung is not a trajectory, so the gloss would be noise. -->
              <span v-if="p.priorTrajectory.includes('→')" class="text-stone-400">
                (falling levels = internalizing)
              </span>
            </p>

            <div v-if="p.priorNote" class="mt-2 rounded-lg bg-stone-50 px-3 py-2">
              <p class="text-xs text-stone-400">You wrote on {{ p.priorNote.date }}:</p>
              <p class="mt-0.5 text-sm text-stone-600">“{{ p.priorNote.text }}”</p>
              <button
                class="mt-1 text-xs text-emerald-700 underline hover:text-emerald-900"
                @click="notes[p.code] = p.priorNote.text"
              >
                Start from that and sharpen it
              </button>
            </div>

            <template v-if="!skipped.includes(p.code)">
              <label :for="`note-${p.code}`" class="mt-3 block text-sm text-stone-600">
                {{ p.question }}
              </label>
              <input
                :id="`note-${p.code}`"
                v-model="notes[p.code]"
                type="text"
                class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
                placeholder="the rule as you'd tell it to yourself"
              />
              <button
                class="mt-1 text-xs text-stone-400 underline hover:text-stone-600"
                @click="skipNote(p.code)"
              >
                Nothing to say about this one
              </button>
            </template>
            <p v-else class="mt-3 text-xs text-stone-400">
              Skipped.
              <button class="underline hover:text-stone-600" @click="unskipNote(p.code)">Undo</button>
            </p>
          </div>

          <p v-if="quietPatterns.length && !showAllNotes" class="mt-4 text-xs text-stone-400">
            Also logged to the ledger:
            <span v-for="(p, i) in quietPatterns" :key="p.code">
              <span class="font-mono">{{ p.code }}</span>{{ i < quietPatterns.length - 1 ? ', ' : '' }}
            </span>
            ·
            <button class="underline hover:text-stone-600" @click="showAllNotes = true">
              write notes for these too
            </button>
          </p>
        </template>
        <p v-else class="text-sm text-stone-600">No errors to log — the session goes straight to the ledger.</p>

        <button
          class="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          @click="finishSession"
        >
          Finish session
        </button>
      </section>
    </div>

    <!-- Step: done -->
    <section v-else-if="step === 'done'" class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-stone-400">Session complete</p>
      <p class="mt-2 text-sm text-stone-600">
        {{ review.fixes.length ? `${review.fixes.length} error${review.fixes.length === 1 ? '' : 's'} worked through across ${checkCount} check${checkCount === 1 ? '' : 's'}, and they're in your ledger.` : 'A clean first draft — logged.' }}
      </p>

      <ul v-if="writtenNotes.length" class="mt-3 space-y-1">
        <li v-for="[code, text] in writtenNotes" :key="code" class="text-sm text-stone-600">
          <span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-xs">{{ code }}</span>
          “{{ text }}”
        </li>
      </ul>

      <!-- The evidence is freshest right now, so this is where the loop closes. -->
      <div v-if="promoted" class="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Now targeting <strong>{{ promoted }}</strong> — future tasks will quietly obligate it.
      </div>
      <div v-else-if="promotable" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <p class="text-sm text-emerald-900">
          <strong>{{ promotable }}</strong> — {{ patternFor(promotable)?.name }} — has come up more
          than once now. Make it an active target? Tasks will be built to obligate it, without
          naming it.
        </p>
        <button
          class="mt-2 rounded border border-emerald-600 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
          @click="promote(promotable)"
        >
          Target it
        </button>
      </div>

      <button class="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" @click="newSession">
        New session
      </button>
    </section>
  </div>
</template>
