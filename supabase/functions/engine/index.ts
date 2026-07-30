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

const MODEL = Deno.env.get('MODEL') ?? 'claude-opus-5'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const FALLBACK_MODEL = Deno.env.get('FALLBACK_MODEL') ?? ''
const FALLBACK_API_KEY = Deno.env.get('FALLBACK_API_KEY') ?? ''
const FALLBACK_BASE_URL = Deno.env.get('FALLBACK_BASE_URL') ?? ''

const hasPrimary = Boolean(ANTHROPIC_API_KEY)
const hasFallback = Boolean(FALLBACK_MODEL && FALLBACK_API_KEY && FALLBACK_BASE_URL)

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
  return { content: block.text as string, via: MODEL, fallback: false }
}

// OpenAI-compatible shape: OpenCode Zen/Go, DeepSeek, OpenRouter, Ollama.
// No schema enforcement here — the caller's prompt spells the JSON shape out
// and the client validates on the way back in.
async function callFallback(system: string, user: string, maxTokens: number) {
  const res = await fetch(`${FALLBACK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${FALLBACK_API_KEY}`,
    },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    throw new Error(`${FALLBACK_MODEL} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error(`${FALLBACK_MODEL} returned no content.`)
  return { content: content as string, via: FALLBACK_MODEL, fallback: true }
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

  // --- primary, then fallback ---------------------------------------------
  if (hasPrimary) {
    try {
      return json(await callAnthropic(system, userMsg, maxTokens, body.schema))
    } catch (e) {
      if (!hasFallback) return json({ error: (e as Error).message }, 502)
      try {
        return json(await callFallback(system, userMsg, maxTokens))
      } catch (f) {
        return json(
          { error: `${MODEL}: ${(e as Error).message} — ${FALLBACK_MODEL}: ${(f as Error).message}` },
          502
        )
      }
    }
  }
  if (hasFallback) {
    try {
      return json(await callFallback(system, userMsg, maxTokens))
    } catch (f) {
      return json({ error: (f as Error).message }, 502)
    }
  }
  return json({ error: 'No model configured on the server.' }, 500)
})
