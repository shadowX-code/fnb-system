import { createClient } from '@supabase/supabase-js'
import { recordRecipeAuthEvent, withRecipeDiagnostics } from '../services/factoryRecipeDiagnostics.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  { global: { fetch: withRecipeDiagnostics((input, init) => globalThis.fetch(input, init)) } }
)

// Passive synchronous metadata only; diagnostic reports never contain session/token values.
supabase.auth.onAuthStateChange((event, session) => recordRecipeAuthEvent(event, session?.user?.id))
