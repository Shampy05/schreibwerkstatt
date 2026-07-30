# Schreibwerkstatt

Personal German writing-practice app — the build of "Loop A + error ledger" from the
SLA-research design (write → graduated feedback → clean rewrite → languaging note → ledger).
Deliberately non-overlapping with Garten (vocabulary) and Anki (recall drilling): every
interaction here is *production*.

Deployed as a static site on GitHub Pages, with Supabase for auth, data, and a model
proxy. **No model-provider key ever reaches the browser** — `VITE_*` vars are inlined
verbatim into the bundle, so anything that can spend money lives as an Edge Function
secret instead. The only client-side keys are the Supabase URL and anon key, which are
publishable by design (RLS is the actual guard).

## Setup

```bash
cp .env.example .env   # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only
npm install
npm run dev            # http://localhost:5175
```

Then, once per project:

```bash
npx supabase link --project-ref tpsgpghpqgzmgjlshdzj
npx supabase db push
npx supabase secrets set ALLOWED_EMAILS=you@example.com COMPAT_MODEL=… COMPAT_API_KEY=… COMPAT_BASE_URL=…
npx supabase functions deploy engine --use-api
```

`ALLOWED_EMAILS` is not optional in spirit: Supabase Auth permits public signup, so
without it anyone who signs up can spend your model budget. Either set it or disable
signups in the Supabase dashboard.

## How a session works

1. **Task** — generated per session from your active targets and steered away from
   your recent tasks. A concrete situation (addressee, purpose, content) plus 2–3
   structural requirements that create an *obligatory context* for the target
   pattern. This exists because of avoidance (Schachter 1974): a vague topic lets
   you write six safe SVO sentences, so the ledger fills with spelling errors while
   the real gaps stay invisible. The generator may name a German trigger word
   (`weil`) but never shows the structure in use — that's the part you produce.
   It also ships a short glossary of the content words that situation forces, collapsed
   behind a toggle. Missing vocabulary causes avoidance just as reliably as missing
   structure, and vocabulary is Garten's job, not this app's — so you get `der
   Wasserhahn, -hähne`, and you still have to decline it yourself. `prompts.js` holds a
   static bank used as the offline/failure fallback.
2. **Draft** — no live correction (retrieval effort is the point). Mark uncertain forms with a
   trailing `?` — the analysis addresses those first (Swain's hypothesis-testing).
3. **Feedback ladder** — one card per error; help escalates only when you ask:
   L1 locate → L2 underline → L3 pattern code → L4 rule explanation → L5 correction.
   The engine returns the full analysis in one call; the ladder is client-side progressive
   disclosure, so the correction exists but is never shown first.
4. **Rewrite until clean** — feedback without required revision does ≈ nothing (Truscott's
   valid point), so the session ends with a verified clean text.
5. **Languaging note** — one sentence per pattern, in your own words; stored on the pattern.

The **Ledger** tab is the data spine: per-pattern occurrence counts, help-level trajectories
(L4 → L2 → L1 = internalization), your notes, and the ≤3 active targets that bias prompt
selection (focused-WCF).

## Architecture

- `src/lib/taxonomy.js` — German error-pattern taxonomy, keyed to Processability stages
- `src/lib/ladder.js` — graduated-feedback rungs (pure, tested)
- `src/lib/ledger.js` — pattern ledger operations (pure, tested)
- `src/lib/prompts.js` — fallback prompt bank tagged with obligated patterns (tested)
- `src/lib/engine.js` — the two model calls (task generation, draft analysis): prompts
  and JSON schemas built client-side, then handed to the proxy. Names no provider and
  holds no key
- `src/lib/level.js` / `src/lib/stage.js` — CEFR ceiling and Processability floor
- `src/lib/jsonText.js` — recovers JSON from a chatty model response
- `src/composables/useStore.js` — Supabase persistence, localStorage as cache only
- `supabase/functions/engine/` — the model proxy (holds the keys, enforces auth)

### The engine proxy

Prompt construction stays on the client (it's pedagogy, not a secret); the call goes
through the `engine` Edge Function, which holds every model credential and keeps the
provider chain server-side. Two auth layers: `verify_jwt` rejects unsigned requests, but
since the anon key is itself a valid project JWT, the function additionally requires a
real user *and* an allowlisted email.

Two interchangeable providers, ordered by `ENGINE_ORDER` (default `compat,anthropic`):
`compat` is any OpenAI-compatible gateway — OpenCode Zen/Go, DeepSeek, OpenRouter — and
`anthropic` is the Messages API. Whichever is named first leads; the other catches its
failures. Only the Anthropic path can enforce the JSON schema, so on the compat path the
shape is prompted as well as validated client-side.

Sessions record which model graded them (`gradedBy`), and the feedback step always names
it — quietly when your first choice answered, in amber when it didn't. Which model wrote
your pattern codes is worth knowing: those codes steer future task generation and the
stage diagnosis.

### Data

`sessions` and `user_settings` in Postgres, RLS-scoped to your user. The error ledger
is **not** a table: it's a pure fold over `sessions` (`buildLedger`), so it can never
disagree with the sessions that produced it.

`npm test` runs the vitest suite for the pure modules.

## Not built yet (by design — validate Loop A first)

Loop B (spaced resurfacing of due patterns as new obligating tasks), Loop C (timed
automatization sprints), model-text comparison mode. See the design doc for the research
grounding.
