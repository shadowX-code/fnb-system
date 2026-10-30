import { createClient } from '@supabase/supabase-js'

import { factoryDiagnosticFetch } from '../features/factory/utils/factoryRuntimePerformance.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  { global: { fetch: factoryDiagnosticFetch } }
)