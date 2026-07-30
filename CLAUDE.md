# Schreibwerkstatt — agent guidelines

Personal German writing-practice app for a single user. Local-first Vue 3 + Vite SPA,
no backend, no auth, no deployment. Read `README.md` for the session flow.

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
- **Review means produce, never recall.** No flashcards, no cloze drills. If a
  pattern needs resurfacing it comes back as a new writing task that obligates it.
- **No live as-you-type correction.** Retrieval effort is the mechanism.
- **Tasks must create obligatory contexts.** Learners avoid structures they're unsure
  of, so a vague topic yields safe SVO sentences and the ledger fills with spelling
  errors while the real gaps stay invisible. Generated tasks carry explicit structural
  requirements. Naming a German trigger word (`weil`) is fine; showing the structure
  in use is not.
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
- `src/lib/engine.js` — the two Claude calls (task generation, draft analysis).
  Structured JSON output, `claude-opus-5` by default (`VITE_MODEL` overrides).
- `src/lib/compat.js` — optional fallback provider, OpenAI-compatible shape.
- `src/lib/store.js` + `src/composables/useStore.js` — one localStorage key,
  reactive singleton, deep-watch auto-persist.
- Components are plain `<script setup>` + Tailwind utility classes. No design system,
  no component library — match the surrounding markup.

`npm test` runs vitest over the pure modules. Keep new pure logic tested; components
are verified in the browser.

## Deployment shape

Static site on GitHub Pages + Supabase (auth, Postgres, one Edge Function). Model calls
go through `supabase/functions/engine/`; prompt construction stays client-side.

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
- **The ledger is derived, not stored.** `buildLedger(sessions)` folds it from sessions,
  oldest-first so rung trajectories read correctly. Don't add a ledger table — that
  creates two sources of truth that drift.
- **Don't deep-watch state into the database.** The cache mirror is a deep watcher, but
  real writes are explicit per mutation; a deep watcher can't tell an insert from a load
  and would echo every fetch straight back to the server.
- **The fallback has no schema enforcement.** Gateways don't proxy `output_config`, so
  the JSON shape is prompted *as well as* schema'd and validated on return. Anything
  reading engine output must tolerate malformed entries — `normalizeErrors` drops them
  and filters codes through `CODE_SET`.
- **A wrong pattern code is worse than a missing one.** It writes a false gap into the
  ledger, which then steers task generation, resurfacing, *and* the stage diagnosis.
  Hence the strongest default model and the UI naming the model when the fallback grades.
- **Generated tasks are cached for 24h** (`taskCache.js`) and cleared on completion or
  "Different task". Regenerating on every mount was burning real money on hot reloads.
  Stock fallback prompts are deliberately *not* cached, or a transient outage would
  suppress retries for a day.

## Deliberately not built

Loop B (spaced resurfacing of due patterns as new obligating tasks), Loop C (timed
automatization sprints), and model-text comparison mode. These are designed but
unbuilt pending validation of Loop A — don't build them without asking.
