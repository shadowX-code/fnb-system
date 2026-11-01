import { createClient } from '@supabase/supabase-js'

import { factoryDiagnosticFetch } from '../features/factory/utils/factoryRuntimePerformance.js'
import { recordRecipeAuthEvent, withRecipeDiagnostics } from '../services/factoryRecipeDiagnostics.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  { global: { fetch: withRecipeDiagnostics(factoryDiagnosticFetch) } }
)

// Passive synchronous metadata only; diagnostic reports never contain session/token values.
supabase.auth.onAuthStateChange((event, session) => recordRecipeAuthEvent(event, session?.user?.id))
