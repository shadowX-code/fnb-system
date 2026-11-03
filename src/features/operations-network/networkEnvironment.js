// Build-owned data identity, never a URL parameter, storage value or React preference.
export function networkDemoAllowed({ dataUrl, development = false }) {
  return dataUrl === 'https://ujkzdaaadnvcfayuldmh.supabase.co'
    || (development && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(dataUrl || ''));
}

export const NETWORK_DEMO_ALLOWED = networkDemoAllowed({
  dataUrl: import.meta.env.VITE_SUPABASE_URL,
  development: import.meta.env.DEV,
});
