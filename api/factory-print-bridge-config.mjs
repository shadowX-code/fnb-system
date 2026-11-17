const PROJECT = "ujkzdaaadnvcfayuldmh";
const URL = `https://${PROJECT}.supabase.co`;

export function bridgePublicKey(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    return claims.ref === PROJECT && claims.role === "anon";
  } catch {
    return false;
  }
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).end();
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (req.headers.host !== "fnb-system-staging.vercel.app" ||
      process.env.VITE_SUPABASE_URL !== URL || !bridgePublicKey(key)) {
    return res.status(404).end();
  }
  return res.status(200).json({ publishableKey: key });
}
