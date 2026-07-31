// Time a REAL analysis call against the gateway, outside Supabase.
//
// Earlier curl tests used a one-line system prompt, which is nothing like the
// real request: the analysis prompt carries the whole taxonomy plus the level
// block, and the task is genuinely hard rather than invented filler. This
// rebuilds that shape from the actual source so the numbers mean something,
// and lets you compare models on the real workload in one command.
//
// It reports the two things that decide a model, not just speed:
//   - wall time and reasoning tokens (reasoning is the dominant cost, and
//     max_tokens cannot bound it)
//   - whether the pattern codes are real and the quotes verbatim, because a
//     wrong code writes a false gap into the ledger that then steers task
//     generation and the stage diagnosis
//
// JSON mode is retried when it yields empty content: glm-5.2 on this gateway
// returns an empty string with response_format set and a good object without.
//
// Usage:
//   OPENCODE_KEY=... node scripts/time-analysis.mjs [model ...]
//
// The key is read from the environment and never printed.

import { taxonomyPromptBlock, CODE_SET } from '../src/lib/taxonomy.js'
import { analysisLevelBlock } from '../src/lib/level.js'
import { parseJsonText } from '../src/lib/jsonText.js'
import { explanationLeaks } from '../src/lib/leakGuard.js'

const KEY = process.env.OPENCODE_KEY
if (!KEY) {
  console.error('Set OPENCODE_KEY in the environment first.')
  process.exit(1)
}

const BASE = process.env.OPENCODE_BASE_URL ?? 'https://opencode.ai/zen/go/v1'
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 2048)
const MODELS = process.argv.slice(2)
if (!MODELS.length) MODELS.push('grok-4.5')

// A real learner draft, errors and all.
const TEXT = `Hallo Herr Krüger. Morgens finde ich, dass deines Haustierschildkröte durch meiner Katzenklappe kriechen hatte. Es ist weisen Fußabdruck über den Boden lassen gewesen und das Basilikum knabbern hat. Ich könnte es bisher nicht finden aber ich versuche ihn zu dein Hause ablocken.`

const SYSTEM = `You are the analysis engine inside a German writing-practice app for a single adult English-speaking learner. You receive a short German text the learner wrote and return a structured error analysis. You never talk to the learner directly — the app controls what is revealed and when.

${analysisLevelBlock('B1')}

Rules:
- Never invent an error. If a form is acceptable standard German, leave it alone.
- Report AT MOST 12 errors, the ones most worth working on.
- Keep "explanation" to one sentence.
- Classify each error with exactly one code from the taxonomy below.
- "quote" must be an exact verbatim substring of the learner's text.

Taxonomy:
${taxonomyPromptBlock()}

Respond with ONLY a JSON object — no prose, no markdown fence:
{"clean": boolean, "errors": [{"quote": string, "sentence_index": integer, "pattern_code": string, "explanation": string, "correction": string}], "praise": string}`

async function call(model, jsonMode) {
  const started = Date.now()
  const res = await fetch(`${BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Analyze this learner text:\n\n${TEXT}` },
      ],
    }),
  })
  const secs = (Date.now() - started) / 1000
  if (!res.ok) return { secs, error: `HTTP ${res.status} — ${(await res.text()).slice(0, 120)}` }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message ?? {}
  const u = data?.usage ?? {}
  return {
    secs,
    content: msg.content ?? '',
    // Some gateways report reasoning separately, some fold it into the total,
    // some expose it only as a reasoning_content string. Catch all three.
    reasoning:
      u.completion_tokens_details?.reasoning_tokens ??
      (msg.reasoning_content ? `~${Math.round(msg.reasoning_content.length / 4)} (est)` : null),
    inTok: u.prompt_tokens,
    outTok: u.completion_tokens,
    finish: data?.choices?.[0]?.finish_reason,
  }
}

function report(model, r, note) {
  console.log(
    `\n${model}${note ? ` ${note}` : ''}  —  ${r.secs.toFixed(1)}s   ` +
      `in=${r.inTok ?? '?'} out=${r.outTok ?? '?'}  reasoning=${r.reasoning ?? 'none'}` +
      (r.finish && r.finish !== 'stop' ? `  finish=${r.finish}` : '')
  )
  let parsed
  try {
    parsed = parseJsonText(r.content)
  } catch (e) {
    console.log(`  UNUSABLE: ${e.message}`)
    console.log(`  raw head: ${JSON.stringify(r.content.slice(0, 160))}`)
    return false
  }
  const errs = Array.isArray(parsed.errors) ? parsed.errors : []
  const badCodes = errs.filter((e) => !CODE_SET.has(e?.pattern_code))
  const badQuotes = errs.filter((e) => typeof e?.quote !== 'string' || !TEXT.includes(e.quote))
  // Rung 4 leaking rung 5's answer is a pedagogy failure, not a formatting
  // one, and every model tested does it — the app redacts, but it is worth
  // seeing which models need the most redacting.
  const leaks = errs.filter((e) => explanationLeaks(e?.explanation, e?.quote, e?.correction))
  console.log(
    `  errors=${errs.length}  bad codes=${badCodes.length}  quotes not verbatim=${badQuotes.length}` +
      `  explanations leaking the answer=${leaks.length}`
  )
  if (badCodes.length) {
    console.log(`  invented codes: ${[...new Set(badCodes.map((e) => e?.pattern_code))].join(', ')}`)
  }
  if (errs[0]) console.log(`  sample: [${errs[0].pattern_code}] „${errs[0].quote}“ — ${errs[0].explanation}`)
  return true
}

console.log(`system prompt: ~${Math.round(SYSTEM.length / 4)} tokens, max_tokens=${MAX_TOKENS}`)

for (const model of MODELS) {
  try {
    const withMode = await call(model, true)
    if (withMode.error) {
      console.log(`\n${model}  —  ${withMode.secs.toFixed(1)}s   ${withMode.error}`)
      continue
    }
    if (withMode.content.trim()) {
      report(model, withMode)
      continue
    }
    // Empty content with JSON mode on is the glm-5.2 failure. Retry without it
    // before writing the model off — COMPAT_JSON_MODE=off exists for this.
    console.log(`\n${model}  —  ${withMode.secs.toFixed(1)}s   empty content with JSON mode; retrying without…`)
    const without = await call(model, false)
    if (without.error) {
      console.log(`  retry failed: ${without.error}`)
      continue
    }
    report(model, without, '(COMPAT_JSON_MODE=off)')
  } catch (e) {
    console.log(`\n${model}  —  failed: ${e.message}`)
  }
}
