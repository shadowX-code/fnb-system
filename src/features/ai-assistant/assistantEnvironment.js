// Build-owned Staging identity; never enabled by query strings or browser storage.
export function assistantStagingAllowed(dataUrl) {
  return dataUrl === 'https://ujkzdaaadnvcfayuldmh.supabase.co';
}
export const ASSISTANT_STAGING_ALLOWED = assistantStagingAllowed(import.meta.env.VITE_SUPABASE_URL);
