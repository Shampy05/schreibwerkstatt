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
const COMPAT_MODEL = Deno.env.get('COMPAT_MODEL') ?? Deno.env.get('FALLBACK_MODEL') ?? ''
const COMPAT_API_KEY = Deno.env.get('COMPAT_API_KEY') ?? Deno.env.get('FALLBACK_API_KEY') ?? ''
const COMPAT_BASE_URL = Deno.env.get('COMPAT_BASE_URL') ?? Deno.env.get('FALLBACK_BASE_URL') ?? ''

const hasAnthropic = Boolean(ANTHROPIC_API_KEY)
const hasCompat = Boolean(COMPAT_MODEL && COMPAT_API_KEY && COMPAT_BASE_URL)

async function callAnthropic(system: string, user: string, maxTokens: number, schema: unknown) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
  })
  if (!res.ok) throw new Error(`${MODEL} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  if (data.stop_reason === 'refusal') {
    throw new Error('The feedback engine declined this text. Try rephrasing and re-checking.')
  }
  const block = (data.content ?? []).find((b: { type: string }) => b.type === 'text')
  if (!block?.text) throw new Error('Empty analysis response.')
  return { content: block.text as string, via: MODEL, schemaEnforced: true }
}

// OpenAI-compatible shape: OpenCode Zen/Go, DeepSeek, OpenRouter, Ollama.
// No schema enforcement here — the caller's prompt spells the JSON shape out
// and the client validates on the way back in.
async function callCompat(system: string, user: string, maxTokens: number) {
  const res = await fetch(`${COMPAT_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${COMPAT_API_KEY}`,
    },
    body: JSON.stringify({
      model: COMPAT_MODEL,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`${COMPAT_MODEL} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error(`${COMPAT_MODEL} returned no content.`)
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

  const failures: string[] = []
  for (const [i, provider] of chain.entries()) {
    try {
      const result =
        provider === 'anthropic'
          ? await callAnthropic(system, userMsg, maxTokens, body.schema)
          : await callCompat(system, userMsg, maxTokens)
      return json({ ...result, fallback: i > 0 })
    } catch (e) {
      failures.push((e as Error).message)
    }
  }
  return json({ error: failures.join(' — ') }, 502)
})
