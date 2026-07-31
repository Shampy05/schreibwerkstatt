// Model proxy. The only reason this exists: a static site cannot hold an API
// key. Everything pedagogical stays on the client — this function receives an
// already-built system/user prompt, calls the model, and returns raw JSON text.
//
// Two auth layers, because verify_jwt alone is not enough:
//   1. verify_jwt = true (config.toml) rejects unsigned requests — but the anon
//      key is itself a valid project JWT, so that alone would leave this an open
//      proxy on your bill.
//   2. auth.getUser() must resolve to a real user, AND that user's email must be
//      in ALLOWED_EMAILS. Supabase Auth permits public signup by default, so
//      "signed in" is not the same as "is you".

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// Two interchangeable providers, either of which may lead:
//   compat    — any OpenAI-compatible gateway (OpenCode Zen/Go, DeepSeek, OpenRouter)
//   anthropic — the Messages API
// ENGINE_ORDER picks the chain; whichever is named first is tried first and the
// other catches its failures. Default leads with compat. The COMPAT_* names are
// the current ones; FALLBACK_* are the original names and still work, so
// flipping the order needs no secrets to be re-set.
const DEFAULT_ORDER = ['compat', 'anthropic']
const CONFIGURED_ORDER = (Deno.env.get('ENGINE_ORDER') ?? '')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p) => p === 'compat' || p === 'anthropic')
// A typo'd ENGINE_ORDER means "no providers at all", which would look like a
// missing key rather than a bad setting — fall back to the default instead.
const ORDER = CONFIGURED_ORDER.length ? CONFIGURED_ORDER : DEFAULT_ORDER

const MODEL = Deno.env.get('MODEL') ?? 'claude-opus-5'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
// JSON mode is an optimisation, not a requirement: the caller spells the JSON
// shape out in the prompt too, because this path can't enforce a schema either
// way. Some models are actively harmed by it — glm-5.2 on the OpenCode gateway
// returns an EMPTY content string when response_format is set, and a perfectly
// good object when it isn't. Set COMPAT_JSON_MODE=off for those.
const COMPAT_JSON_MODE = (Deno.env.get('COMPAT_JSON_MODE') ?? 'on').toLowerCase() !== 'off'
const COMPAT_MODEL = Deno.env.get('COMPAT_MODEL') ?? Deno.env.get('FALLBACK_MODEL') ?? ''
const COMPAT_API_KEY = Deno.env.get('COMPAT_API_KEY') ?? Deno.env.get('FALLBACK_API_KEY') ?? ''
const COMPAT_BASE_URL = Deno.env.get('COMPAT_BASE_URL') ?? Deno.env.get('FALLBACK_BASE_URL') ?? ''

const hasAnthropic = Boolean(ANTHROPIC_API_KEY)
const hasCompat = Boolean(COMPAT_MODEL && COMPAT_API_KEY && COMPAT_BASE_URL)

// Supabase kills an Edge Function at 150s wall clock (free plan) and 504s on a
// 150s idle timeout. A killed isolate sends no response headers at all, which
// the browser reports as "CORS request did not succeed" with a null status —
// an opaque failure that looks like a config problem and isn't. So bound every
// upstream call ourselves and always come back with real JSON well before the
// platform intervenes.
//
// The budget is well under Supabase's 150s because the endpoint sits behind
// Cloudflare (see `server: cloudflare` on every response), whose standard proxy
// read timeout is 100s — and a 524 from an intermediary arrives without our CORS
// headers, so the browser reports it as a failed CORS request with a null
// status, exactly the symptom we are trying to eliminate. Budget for the
// tightest limit in the chain, not the one we control.
//
// The budget is NOT the whole wall clock. Cold-starting the isolate (it imports
// supabase-js from jsr) and the auth.getUser() round trip both happen before the
// budget starts counting, and serializing the response happens after it. An
// 85s attempt inside a 90s budget therefore lands the response somewhere in the
// low-to-mid 90s — under the 100s limit on paper, and over it whenever the cold
// start is slow. That configuration was live, and it is what produced the
// intermittent null-status failures: not a wrong value, an absent margin.
// 70s of budget leaves ~25s for everything the budget can't see.
//
// The ceiling is ENFORCED here, not merely defaulted. These are secrets, and a
// secret set once outlives the code that wanted it, so a value tuned against an
// older understanding of the limit silently overrides the default and puts us
// straight back over — where the failure is a null-status CORS error in the
// browser and nothing at all in our logs, because our code never got to return.
// A stale or fat-fingered value may make this function give up sooner; it must
// never let it outlive the proxy. Same for a non-numeric value, which used to
// become NaN and take every timeout with it.
const HARD_CEILING_MS = 75_000

function envMs(name: string, fallback: number, ceiling: number) {
  const raw = Number(Deno.env.get(name) ?? '')
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback
  return Math.min(value, ceiling)
}

const BUDGET_MS = envMs('ENGINE_BUDGET_MS', 70_000, HARD_CEILING_MS)
const ATTEMPT_MS = envMs('ENGINE_ATTEMPT_MS', 55_000, BUDGET_MS)
const MIN_ATTEMPT_MS = 5_000

// Transient upstream conditions worth one immediate retry. We have seen the
// gateway return 503 inference_overloaded, which currently kills a whole
// session's feedback for something that clears in a second.
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529])

type Upstream = Error & { retryable?: boolean }

function upstreamError(message: string, retryable: boolean): Upstream {
  const e = new Error(message) as Upstream
  e.retryable = retryable
  return e
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchUpstream(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    // A timeout is NOT retryable. The model isn't glitching, it's slow, so a
    // second attempt spends the rest of the budget to arrive at the same place
    // — and pushes total wall time past the intermediary limits this timeout
    // exists to stay under. Move to the next provider, or fail with a message
    // that names the real problem.
    throw upstreamError(
      aborted
        ? `${label} did not respond within ${Math.round(timeoutMs / 1000)}s — it may simply be too slow for this setup`
        : `${label} unreachable: ${(e as Error).message}`,
      !aborted
    )
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    throw upstreamError(`${label} ${res.status}: ${body}`, RETRY_STATUSES.has(res.status))
  }
  return res
}

async function callAnthropic(
  system: string,
  user: string,
  maxTokens: number,
  schema: unknown,
  timeoutMs: number
) {
  const res = await fetchUpstream(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        fallbacks: 'default',
        system,
        ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
        messages: [{ role: 'user', content: user }],
      }),
    },
    timeoutMs,
    MODEL
  )
  const data = await res.json()
  if (data.stop_reason === 'refusal') {
    // A refusal is a decision, not a hiccup — retrying just spends money.
    throw upstreamError('The feedback engine declined this text. Try rephrasing and re-checking.', false)
  }
  const block = (data.content ?? []).find((b: { type: string }) => b.type === 'text')
  if (!block?.text) throw upstreamError(`${MODEL} returned an empty response.`, true)
  return { content: block.text as string, via: MODEL, schemaEnforced: true }
}

// OpenAI-compatible shape: OpenCode Zen/Go, DeepSeek, OpenRouter, Ollama.
// No schema enforcement here — the caller's prompt spells the JSON shape out
// and the client validates on the way back in.
async function callCompat(system: string, user: string, maxTokens: number, timeoutMs: number) {
  const res = await fetchUpstream(
    `${COMPAT_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${COMPAT_API_KEY}`,
      },
      body: JSON.stringify({
        model: COMPAT_MODEL,
        max_tokens: maxTokens,
        ...(COMPAT_JSON_MODE ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    timeoutMs,
    COMPAT_MODEL
  )
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw upstreamError(`${COMPAT_MODEL} returned no content.`, true)
  return { content: content as string, via: COMPAT_MODEL, schemaEnforced: false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // --- auth ---------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const user = userData?.user
  if (userError || !user) return json({ error: 'Not signed in.' }, 401)

  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length && !allowed.includes((user.email ?? '').toLowerCase())) {
    return json({ error: 'This account is not permitted to use the engine.' }, 403)
  }

  // --- request ------------------------------------------------------------
  let body: {
    system?: string
    user?: string
    maxTokens?: number
    schema?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const system = typeof body.system === 'string' ? body.system : ''
  const userMsg = typeof body.user === 'string' ? body.user : ''
  const maxTokens = Number.isInteger(body.maxTokens) ? Math.min(body.maxTokens!, 8192) : 4096
  if (!system || !userMsg) return json({ error: 'system and user are required.' }, 400)

  // --- run the chain in ENGINE_ORDER --------------------------------------
  // `fallback` is positional, not provider-specific: it means "the one we
  // wanted didn't answer", which is what the UI warns about.
  const chain = ORDER.filter((p) => (p === 'anthropic' ? hasAnthropic : hasCompat))
  if (!chain.length) return json({ error: 'No model configured on the server.' }, 500)

  const started = Date.now()
  const deadline = started + BUDGET_MS
  const failures: string[] = []
  // Every failure says how long it took. Without it, "too slow" and "refused
  // instantly" reach the learner as the same sentence, and the only way to tell
  // them apart is the dashboard.
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`

  for (const [i, provider] of chain.entries()) {
    // Two attempts per provider, the second only for transient failures.
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining < MIN_ATTEMPT_MS) {
        failures.push(`gave up after ${elapsed()} to stay inside the platform's limit`)
        return json({ error: failures.join(' — ') }, 504)
      }
      const timeoutMs = Math.min(ATTEMPT_MS, remaining)
      try {
        const result =
          provider === 'anthropic'
            ? await callAnthropic(system, userMsg, maxTokens, body.schema, timeoutMs)
            : await callCompat(system, userMsg, maxTokens, timeoutMs)
        return json({ ...result, fallback: i > 0, retried: attempt > 0 })
      } catch (e) {
        const err = e as Upstream
        failures.push(err.message)
        if (!err.retryable || attempt === 1) break
        await sleep(1_200)
      }
    }
  }
  return json({ error: `${failures.join(' — ')} (after ${elapsed()})` }, 502)
})
