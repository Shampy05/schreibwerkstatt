// The feedback engine: one structured-analysis call to Claude per check.
//
// Pedagogy contract: the model returns the FULL analysis (span, code,
// explanation, correction) in one response, but the UI reveals it rung by
// rung (see ladder.js) — the model is a feedback-policy executor, not a
// tutor with free rein. The explanation field is instructed to never leak
// the corrected form, so rung 4 stays metalinguistic.
//
// NO MODEL KEY LIVES HERE. Prompt construction stays client-side (it is
// pedagogy, not a secret), but the call itself goes through the `engine` Edge
// Function, which holds the keys and enforces auth. An earlier version put
// VITE_ANTHROPIC_API_KEY in this file; Vite inlines VITE_* vars verbatim, so
// building the app baked the key into dist/assets/index-*.js. Anything that can
// spend money must stay server-side — see supabase/functions/engine/index.ts.

import { taxonomyPromptBlock, TAXONOMY, CODE_SET, patternFor } from './taxonomy'
import { parseJsonText } from './jsonText'
import { analysisLevelBlock, taskLevelBlock } from './level'
import { stagePromptBlock } from './stage'
import { supabase, hasSupabase } from './supabase'

export const hasEngine = hasSupabase

// One call to the proxy. Returns { parsed, via, fallback }.
async function invokeEngine({ system, user, maxTokens, schema }) {
  if (!hasSupabase) {
    throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  const { data, error } = await supabase.functions.invoke('engine', {
    body: { system, user, maxTokens, schema },
  })
  if (error) {
    // FunctionsHttpError carries the real message in the response body; without
    // this you only ever see a generic "non-2xx status code".
    let detail = ''
    try {
      const body = await error.context?.json?.()
      if (body?.error) detail = body.error
    } catch {
      /* no readable body — fall through to the transport-level message */
    }
    if (!detail) {
      // No body at all means the request never completed: the function was cut
      // off mid-flight, or the network dropped. The browser surfaces that as a
      // CORS failure with a null status, which reads like a config problem and
      // isn't one — so say what actually happened.
      detail = `The engine didn't answer (${error.message}). It may still have been working when the connection dropped — try again.`
    }
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  if (!data?.content) throw new Error('The engine returned no content.')
  return {
    parsed: parseJsonText(data.content),
    via: data.via,
    fallback: Boolean(data.fallback),
  }
}

// How many errors one analysis pass may report.
//
// Measured: this gateway generates at roughly 90 tokens/s, so a 25-error
// analysis with two-sentence explanations takes ~43s — close enough to the
// intermediary timeouts to fail outright, and the cost is entirely output
// length. Capping it is not merely a latency fix, though: focused feedback
// beats unfocused (Kang & Han; the same finding behind MAX_ACTIVE_TARGETS),
// and a wall of 27 cards is worse teaching than a dozen well-chosen ones.
// Nothing is lost — the rewrite is re-analysed, so anything held back surfaces
// on the next pass, which is how the loop already works.
export const MAX_REPORTED_ERRORS = 12

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    clean: {
      type: 'boolean',
      description: 'true when the text contains no errors worth reporting',
    },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: {
            type: 'string',
            description:
              'EXACT verbatim substring of the learner text containing the error — as short as possible while unambiguous, copied character-for-character',
          },
          sentence_index: {
            type: 'integer',
            description: '0-based index of the sentence containing the error (sentences split on . ! ? followed by whitespace)',
          },
          pattern_code: {
            type: 'string',
            enum: TAXONOMY.map((p) => p.code),
          },
          explanation: {
            type: 'string',
            description:
              'ONE sentence (two only if genuinely necessary). Metalinguistic explanation (in English) of the rule as it applies to this specific error. MUST NOT contain or paraphrase the corrected form — the learner should still have to produce the fix themselves.',
          },
          correction: {
            type: 'string',
            description: 'The corrected version of the quoted span only (not the whole sentence unless necessary)',
          },
        },
        required: ['quote', 'sentence_index', 'pattern_code', 'explanation', 'correction'],
        additionalProperties: false,
      },
    },
    praise: {
      type: 'string',
      description:
        'One short, specific sentence noting something the learner did correctly that is non-trivial (a structure, not spelling). Empty string if nothing stands out.',
    },
  },
  required: ['clean', 'errors', 'praise'],
  additionalProperties: false,
}

const analysisSystem = (level) => `You are the analysis engine inside a German writing-practice app for a single adult English-speaking learner. You receive a short German text the learner wrote and return a structured error analysis. You never talk to the learner directly — the app controls what is revealed and when.

${analysisLevelBlock(level)}

Rules:
- Never invent an error. If a form is acceptable standard German, leave it alone. Colloquial-but-correct is not an error.
- Report AT MOST ${MAX_REPORTED_ERRORS} errors. If the text has more, report the ${MAX_REPORTED_ERRORS} most worth working on and leave the rest — the learner rewrites and is re-analysed, so the remainder surfaces next pass. Priority: spans the learner marked with a trailing ?, then errors that block comprehension, then repeated patterns (report the clearest instance, not all of them), then the rest. Never pad the list with spelling when a structural error went unreported.
- Keep "explanation" to one sentence. Length here costs the learner nothing but waiting.
- Classify each error with exactly one code from the taxonomy below. When two codes could apply, pick the one naming the rule the learner actually broke.
- "quote" must be an exact, verbatim, character-for-character substring of the learner's text. Keep it short but unambiguous (unique in the text if possible).
- "explanation" states the rule as it applies here, in English, WITHOUT revealing or paraphrasing the corrected form. Name the trigger ("weil starts a subordinate clause, and subordinate clauses put the finite verb…") but stop before giving the answer.
- One error, one entry. If a sentence has three independent errors, return three entries.
- A word marked with a trailing ? by the learner is a hypothesis they are unsure about — address those spans first and, when the hypothesis is correct, do not report it as an error (the ? itself is not an error).
- Ignore missing umlauts only when the learner clearly has no ü/ö/ä available (e.g. consistently writes ue/oe/ae); otherwise report as ORTH.

Taxonomy:
${taxonomyPromptBlock()}`

// The shape is spelled out in the prompt as well as the schema, because the
// server may fall through to a provider with no schema enforcement and the
// client can't know which path was taken. Redundant on the Anthropic path,
// load-bearing on the fallback one.
const ANALYSIS_JSON_SHAPE = `Respond with ONLY a JSON object — no prose, no markdown fence:
{"clean": boolean, "errors": [{"quote": string, "sentence_index": integer, "pattern_code": string, "explanation": string, "correction": string}], "praise": string}
"pattern_code" must be exactly one code from the taxonomy above. "clean" is true and "errors" empty when the text has no errors worth reporting. "errors" holds at most ${MAX_REPORTED_ERRORS} entries, and each "explanation" is one sentence.`

const TASK_JSON_SHAPE = `Respond with ONLY a JSON object — no prose, no markdown fence:
{"task": string, "requirements": [string], "obligates": [string], "glossary": [{"de": string, "en": string}]}
"obligates" holds pattern codes from the taxonomy above. "requirements" holds 2–3 short English instructions. "glossary" holds 0–6 German dictionary forms with short English glosses.`

// Normalize an engine error into the app's camelCase shape, dropping
// anything malformed rather than crashing the session.
function normalizeErrors(raw, text) {
  const out = []
  for (const e of raw.errors || []) {
    if (out.length === MAX_REPORTED_ERRORS) break
    if (!e || typeof e.quote !== 'string' || !CODE_SET.has(e.pattern_code)) continue
    out.push({
      quote: e.quote,
      // Trust the quote over the model's index when they disagree.
      sentenceIndex: locateSentence(text, e.quote, e.sentence_index),
      patternCode: e.pattern_code,
      explanation: e.explanation || '',
      correction: e.correction || '',
    })
  }
  return out
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function locateSentence(text, quote, fallbackIndex) {
  const sentences = splitSentences(text)
  const idx = sentences.findIndex((s) => s.includes(quote))
  if (idx !== -1) return idx
  return Number.isInteger(fallbackIndex) ? fallbackIndex : 0
}

export async function analyzeDraft(text, { level } = {}) {
  const { parsed, via, fallback } = await invokeEngine({
    system: `${analysisSystem(level)}\n\n${ANALYSIS_JSON_SHAPE}`,
    user: `Analyze this learner text:\n\n${text}`,
    // Sized to the capped output above, not to headroom. Generation time is
    // linear in tokens produced and the request has a hard ceiling.
    maxTokens: 2048,
    schema: ANALYSIS_SCHEMA,
  })

  return {
    clean: Boolean(parsed.clean) && (parsed.errors || []).length === 0,
    errors: normalizeErrors(parsed, text),
    praise: parsed.praise || '',
    via,
    fallback,
  }
}

// --- Task generation -------------------------------------------------------
//
// The static prompt bank (prompts.js) is the offline fallback; when a key is
// present the task is generated per session instead. The reason is avoidance
// (Schachter 1974): learners systematically dodge structures they're unsure
// of, so a vague topic yields six safe SVO sentences and the ledger fills up
// with spelling errors while the real gaps stay invisible. A generated task
// can carry explicit structural requirements aimed at the current active
// targets — an obligatory context rather than a hopeful tag.

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description:
        'The writing task, in English, 1–3 sentences. A concrete situation: who the learner is writing to, why, and what the text must accomplish. Never a bare topic label.',
    },
    requirements: {
      type: 'array',
      items: { type: 'string' },
      description:
        '2–3 short instructions in English that force the target structures to appear. Each must be checkable by reading the finished text. Never contains a German example clause.',
    },
    obligates: {
      type: 'array',
      items: { type: 'string', enum: TAXONOMY.map((p) => p.code) },
      description: 'The pattern codes this task genuinely obligates.',
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          de: {
            type: 'string',
            description:
              'Dictionary form ONLY: noun with article and plural ("der Wasserhahn, -hähne"), verb as infinitive ("überlaufen"), adjective uninflected. Never a phrase, conjugated form, or clause.',
          },
          en: { type: 'string', description: 'English gloss, 1–3 words.' },
        },
        required: ['de', 'en'],
        additionalProperties: false,
      },
      description:
        '0–6 content words this specific situation forces the learner to use and that they plausibly do not know yet. Empty when the situation needs no special vocabulary.',
    },
  },
  required: ['task', 'requirements', 'obligates', 'glossary'],
  additionalProperties: false,
}

const taskSystem = (level, ceiling) => `You design short German writing tasks for one adult English-speaking learner practising written production.

${taskLevelBlock(level)}
${stagePromptBlock(ceiling)}

The constraint that matters: learners avoid structures they are unsure of. A vague topic ("describe your apartment") produces six safe SVO sentences and teaches nothing. Every task you write must create an OBLIGATORY CONTEXT — a competent writer cannot complete it without producing the target structure.

Rules:
- The task is a concrete situation, in English: a specific addressee, a specific purpose, and specific content that must be conveyed. Details ("your neighbour's cat", "the flat you're subletting in August") beat abstractions.
- Stay in EVERYDAY LIFE. Neighbours, markets, kitchens, weather, trains and lost luggage, pets, landlords, relatives, hobbies, small repairs, holidays, birthdays, a parcel that never arrived. Do NOT write workplace or technology tasks — no offices, colleagues, meetings, laptops, software, chat apps, projects or deadlines — unless a target pattern genuinely cannot be obligated any other way, which is almost never.
- Be a little whimsical. A mild absurdity, a small domestic disaster, a gently ridiculous neighbour, an over-dramatic complaint about a cake. Warmth and humour make the writing worth doing; the situation should raise a small smile while still being a real communicative act. Never twee, never a joke instead of a task.
- Rotate the domain hard. If the recent tasks were about food, go somewhere else entirely — travel, animals, family, weather, bureaucracy, a hobby, a misunderstanding between strangers.
- Requirements are structural, not topical, and read as plain instructions ("give at least two reasons, each introduced with weil"). Naming a German trigger word is fine — that is what creates the context. NEVER write a German example clause or phrase showing the structure in use: the learner has to produce that themselves, and seeing it first destroys the exercise.
- Give a short glossary of the content words this specific situation forces the learner to use and that they plausibly do not know yet — concrete nouns, specific verbs, the odd adjective. 3–6 entries, none at all when the situation genuinely needs no special vocabulary. This matters for the same reason the requirements do: a learner who cannot say "overflowed" writes a different, safer sentence instead, and the structure you were obligating vanishes with it. Vocabulary is not what is being tested here.
- Glossary entries are DICTIONARY FORMS ONLY: nouns with article and plural ("der Wasserhahn, -hähne"), verbs as infinitives ("überlaufen"), adjectives uninflected ("undicht"). Never a phrase, never a conjugated or declined form, never a clause. The article is fine — a noun's gender is vocabulary; making it agree is the grammar being practised, and that stays the learner's job.
- Respect the length stated above; a task that cannot be finished in that many sentences is too big.
- A real communicative purpose, never a grammar drill in disguise. The learner should be able to forget the requirements exist and still hit them.
- Vary sharply from the recent tasks listed: different situation, different register, different content domain.

Taxonomy of patterns you may target:
${taxonomyPromptBlock()}`

// A glossary entry is lexis, so it may not carry structure. Dictionary forms
// are short; anything long enough to be a clause is the generator leaking the
// answer into the vocabulary list, and gets dropped rather than shown.
export function normalizeGlossary(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const g of raw) {
    if (!g || typeof g.de !== 'string' || typeof g.en !== 'string') continue
    const de = g.de.trim()
    const en = g.en.trim()
    if (!de || !en) continue
    if (/[.!?]/.test(de)) continue
    if (de.split(/\s+/).length > 5) continue
    const key = de.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ de, en })
    if (out.length === 6) break
  }
  return out
}

function targetBlock(activeTargets) {
  if (!activeTargets.length) {
    return 'No active targets yet. Write a demanding task that obligates at least one word-order pattern and at least one case or agreement pattern.'
  }
  const lines = activeTargets
    .map((code) => patternFor(code))
    .filter(Boolean)
    .map((p) => `- ${p.code} — ${p.name}: ${p.hint}`)
  return `Target patterns to obligate:\n${lines.join('\n')}`
}

export async function generateTask({
  activeTargets = [],
  recentTasks = [],
  level,
  stageCeiling = null,
} = {}) {
  const recentBlock = recentTasks.length
    ? `\n\nRecent tasks — do not repeat these situations:\n${recentTasks.map((t) => `- ${t}`).join('\n')}`
    : ''
  const { parsed, via } = await invokeEngine({
    system: `${taskSystem(level, stageCeiling)}\n\n${TASK_JSON_SHAPE}`,
    user: `${targetBlock(activeTargets)}${recentBlock}`,
    maxTokens: 2048,
    schema: TASK_SCHEMA,
  })

  if (!parsed.task || typeof parsed.task !== 'string') {
    throw new Error('The task generator returned nothing usable.')
  }
  return {
    id: `gen-${crypto.randomUUID()}`,
    text: parsed.task.trim(),
    requirements: (parsed.requirements || [])
      .filter((r) => typeof r === 'string' && r.trim())
      .map((r) => r.trim())
      .slice(0, 4),
    tags: (parsed.obligates || []).filter((c) => CODE_SET.has(c)),
    glossary: normalizeGlossary(parsed.glossary),
    generated: true,
    via,
  }
}
