# Schreibwerkstatt — agent guidelines

Personal German writing-practice app for a single user. Vue 3 + Vite SPA on GitHub
Pages, with Supabase for auth, data, and a model proxy. Read `README.md` for the
session flow.

## The point of the app

The gap being filled is **producing correct German unprompted in writing**. It is
deliberately not vocabulary acquisition (that's Garten) and not recall drilling
(that's Anki). Every interaction is *production*. The design comes from SLA research;
the pedagogy below is not preference, it is the reason the app exists.

## Pedagogy invariants — do not break these

- **The ladder never runs backwards.** Feedback escalates L1 locate → L2 underline →
  L3 code → L4 explanation → L5 correction, and only when the user asks. The engine
  returns the whole analysis in one call; `FeedbackPanel` reveals it progressively.
  The `explanation` field must never contain or paraphrase the correction — if it
  does, rung 4 has silently become rung 5 and the retrieval effort is gone.
- **Revision is mandatory.** A session ends with a verified clean text. Feedback
  without required revision does approximately nothing.
- **Praise belongs to the first draft only.** `draftPraise` is captured once, in
  `getFeedback`, and never overwritten by a later check. Re-analysing the corrected text
  and praising *that* congratulates the learner for corrections the engine handed them;
  the unaided draft is the only text they actually produced.
- **Languaging is focused, and it needs the learner's own error in front of it.** The
  review step (`src/lib/review.js`) ranks the session's patterns by the rung needed, with
  a bump for repeats, active targets, and errors left unfixed, and asks for a note on the
  top `MAX_NOTE_ASKS` only — everything else is logged silently and can be annotated on
  request. Don't go back to one box per code: you cannot reflect on a taxonomy label, and
  faced with five blank boxes a learner fills none, which is the same focused-WCF finding
  that caps active targets at three. The note field carries the pattern's *question*
  (keyed by taxonomy group), never its `hint` — the hint is the rule, and printing it
  answers what's being asked.
- **Review means produce, never recall.** No flashcards, no cloze drills. If a
  pattern needs resurfacing it comes back as a new writing task that obligates it.
- **No live as-you-type correction.** Retrieval effort is the mechanism.
- **Tasks must create obligatory contexts.** Learners avoid structures they're unsure
  of, so a vague topic yields safe SVO sentences and the ledger fills with spelling
  errors while the real gaps stay invisible. Generated tasks carry explicit structural
  requirements. Naming a German trigger word (`weil`) is fine; showing the structure
  in use is not.
- **Vocabulary is given; grammar is earned.** A generated task ships a small `glossary`
  of the content words its situation forces, collapsed by default in the UI. Missing
  lexis causes avoidance exactly as reliably as missing structure — a writer who can't
  say "overflowed" writes a safer sentence and takes the obligated pattern with it —
  and lexis is Garten's job, not this app's. Entries are dictionary forms only. The
  article is fine (a noun's gender is vocabulary); an inflected form is not (agreement
  is the grammar being practised). `normalizeGlossary` drops anything long enough to
  be a clause, so the vocabulary list can't become a back door for the answer.
- **No gamification.** No streaks, points, or celebrations. The reward is the ledger's
  rung trajectory (L4 → L2 → L1 = internalization).
- **Tasks live in everyday life, with a little whimsy.** Neighbours, markets, pets,
  weather, parcels, small domestic disasters. Explicitly *not* workplace or technology
  scenarios — an earlier persona line ("an English-speaking software developer") turned
  every generated task into Slack messages and demo days. Don't reintroduce an
  occupation into the prompts; it colours everything downstream.

## Level and stage

Two independent knobs, easy to conflate:

- **CEFR level** (`src/lib/level.js`) — the *ceiling*, self-reported (A2–C1, default B1).
  Sets task demand, length, and how strictly the analysis judges. Tasks are pitched at
  the current level and told to reach one level up. The app never assigns this: CEFR is
  assessed against far more than written accuracy, and an app grading its own learner
  on its own errors would be marking its own homework.
- **Processability stage** (`src/lib/stage.js`) — the *floor*, measured from the ledger.
  The learner's stage is the **lowest** stage still producing recent errors; the
  Teachability ceiling is stage + 1, and patterns above it cannot become active targets
  (`isAdmissible` gates both the UI buttons and `suggestTargets`). Unstaged patterns
  (case, adjective endings, tense) are never gated — only word order is stage-bound.
  A null diagnosis means "no evidence", which must apply **no** gate rather than
  defaulting to stage 1.

The known limit, stated in the UI: the ledger records errors, not correct productions,
so a quiet stage may mean acquisition or avoidance. Generated tasks obligate their
targets partly to narrow that gap.

## Architecture

- `src/lib/taxonomy.js` — 24 German error patterns. `code` is the stable identity: it
  keys ledger entries, rides the engine's structured output as an enum, and shows as
  rung 3. Adding or renaming a code touches all three — check every one.
- `src/lib/ladder.js`, `src/lib/ledger.js`, `src/lib/prompts.js`, `src/lib/level.js`,
  `src/lib/stage.js` — pure, tested.
- `src/lib/engine.js` — the two model calls (task generation, draft analysis). Builds
  the prompts and schemas client-side, then invokes the `engine` Edge Function; holds
  no key and names no provider.
- `src/lib/jsonText.js` — recovers JSON from a chatty model response.
- `src/lib/errorMatch.js` — error identity and rewrite resolution (pure, tested).
- `src/lib/store.js` + `src/composables/useStore.js` — Supabase persistence,
  localStorage as cache only.
- Components are plain `<script setup>` + Tailwind utility classes. No design system,
  no component library — match the surrounding markup.

`npm test` runs vitest over the pure modules. Keep new pure logic tested; components
are verified in the browser.

## Deployment shape

Static site on GitHub Pages + Supabase (auth, Postgres, one Edge Function). Model calls
go through `supabase/functions/engine/`; prompt construction stays client-side.

The function chains two interchangeable providers — `compat` (any OpenAI-compatible
gateway) and `anthropic` (the Messages API) — in whatever order `ENGINE_ORDER` names,
default `compat,anthropic`. Whichever leads is tried first and the other catches its
failures; `fallback: true` in the response means "the leading one didn't answer" and is
positional, not provider-specific. `COMPAT_*` secrets are also read under their original
`FALLBACK_*` names, so the order can be flipped without re-setting any keys.

## Gotchas

- **No model-provider key may ever be a `VITE_` var.** Vite inlines `VITE_*` verbatim
  into `dist/assets/*.js`. An earlier version had `VITE_ANTHROPIC_API_KEY`, and building
  the app baked the key into the bundle — verified by string search, and it's how the
  first key got burned. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` belong on
  the client; both are publishable by design. Everything else is an Edge Function secret.
- **`verify_jwt` is not authentication.** The anon key is a valid project JWT, so
  `verify_jwt = true` alone leaves the function an open proxy on your bill. `index.ts`
  also requires `auth.getUser()` to resolve *and* the email to be in `ALLOWED_EMAILS`,
  because Supabase Auth permits public signup.
- **The time budget is not the wall clock, and it is clamped in code.** Cold start and
  `auth.getUser()` run before the budget starts counting and the response is serialized
  after it, so a budget set close to the limit lands *over* it whenever the cold start is
  slow. That is what "CORS request did not succeed", status null, means here: Cloudflare's
  ~100s read timeout fired, its 524 carried none of our CORS headers, and *nothing appears
  in the function logs* because our code never returned. Measured live: `ENGINE_ATTEMPT_MS`
  85000 inside `ENGINE_BUDGET_MS` 90000 produced exactly this. `HARD_CEILING_MS` (75s) now
  wins over both — env vars may lower these values, never raise them — because a secret set
  once outlives the code that wanted it.
- **The ledger is derived, not stored.** `buildLedger(sessions)` folds it from sessions,
  oldest-first so rung trajectories read correctly. Don't add a ledger table — that
  creates two sources of truth that drift.
- **Never match engine errors on an exact quote.** Use `sameError` / `matchError` /
  `resolveWorking` (`src/lib/errorMatch.js`): same pattern code + overlapping normalized
  span. Exact-string matching meant a model that re-quoted an unfixed error with
  different boundaries ("weil es ist" → "es ist") recorded a *resolution* — inventing
  internalization that never happened — while the same error re-entered the working list
  at rung 1, discarding the rungs already climbed. That fold is the app's only progress
  metric; treat a false positive there as a data-corruption bug.
- **The review is frozen when the session reaches it, and reads the pre-session ledger.**
  `buildReview` is called once, on the transition into the review step, because
  `completeSession` rebuilds the ledger underneath it — recomputing afterwards would make
  "seen 3× before" silently start counting today. It also means the review survives the
  autosave/restore round-trip; a snapshot written before the step existed recomputes it.
- **A failed write must be visible and must not lose work.** `completeSession` flags a
  failed insert `pending` instead of dropping it, `mergeSessions` protects it from being
  clobbered by the next load, and `retryPending` re-sends it. `loadError` / `syncError`
  are rendered in `App.vue` — they previously existed but were displayed nowhere, so a
  failed save was indistinguishable from a successful one and the next load silently ate
  the session.
- **Anything the engine asserts must be refusable.** The learner can dismiss an error
  card ("Not an error") and delete a whole session. Both exist because a hallucinated
  pattern code is not cosmetic: it steers task generation, target admissibility, and the
  stage diagnosis. Dismissals are session-scoped and filtered from every later analysis.
- **Never auto-strip a hypothesis mark.** `?` marks a form the learner is unsure of, and
  the engine is told it isn't an error — so a text can pass clean with the scaffolding
  still in it and be stored as the final text. It cannot be removed by rule, though: in
  German every noun is capitalised, so „dem? Mann“ and „…dir? Mein Hund“ are structurally
  identical and any heuristic either eats real punctuation or misses the common case.
  `hypothesisMarks.js` finds them, the languaging step shows each in context, the learner
  removes them one at a time.
- **Only bank ids go in `recentPromptIds`.** It exists solely to stop `pickPrompt`
  repeating itself; a generated task's `gen-<uuid>` means nothing to the bank, and letting
  those in filled all six slots so nothing was ever excluded. `isBankPrompt` gates the
  whole list on write, which also flushes ids stored before the fix.
- **In-progress sessions are local and never hit the server.** `saveDraft` / `loadDraft`
  / `clearDraft` in `store.js`, under their own key. An unfinished draft is scratch work;
  it becomes a row only when the session completes.
- **Don't deep-watch state into the database.** The cache mirror is a deep watcher, but
  real writes are explicit per mutation; a deep watcher can't tell an insert from a load
  and would echo every fetch straight back to the server.
- **The compat path has no schema enforcement.** Gateways don't proxy `output_config`,
  so the JSON shape is prompted *as well as* schema'd and validated on return. Since
  compat leads by default, that redundancy is the normal path, not the rare one:
  anything reading engine output must tolerate malformed entries — `normalizeErrors`
  and `normalizeGlossary` drop them, and codes are filtered through `CODE_SET`.
- **A wrong pattern code is worse than a missing one.** It writes a false gap into the
  ledger, which then steers task generation, resurfacing, *and* the stage diagnosis.
  Hence the feedback step always names the grading model — quietly when the leading
  provider answered, in amber when it didn't.
- **Generated tasks are cached for 24h** (`taskCache.js`) and cleared on completion or
  "Different task". Regenerating on every mount was burning real money on hot reloads.
  Stock fallback prompts are deliberately *not* cached, or a transient outage would
  suppress retries for a day. A cached task also carries a `fingerprint` of the level and
  targets it was generated under — without it, changing either appeared to do nothing at
  all for up to a day.

## Deliberately not built

Loop B (spaced resurfacing of due patterns as new obligating tasks), Loop C (timed
automatization sprints), and model-text comparison mode. These are designed but
unbuilt pending validation of Loop A — don't build them without asking.
