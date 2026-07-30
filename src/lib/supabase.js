import { createClient } from '@supabase/supabase-js'

// NOTE on the key: the Supabase anon key is *designed* to ship in a browser
// bundle — it identifies the project, and Row Level Security is what actually
// guards the data. So unlike the model-provider keys, it is correct for this
// one to be a VITE_ var. Nothing that can spend money or read another user's
// rows is ever exposed to the client.

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(url && anonKey)

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
