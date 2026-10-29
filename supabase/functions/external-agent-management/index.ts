import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { signProbe } from "../_shared/externalAgentProbe.js";
const endpoint = "https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp";
const origins = new Set(["https://fnb-system-staging.vercel.app", "http://localhost:5173"]);
Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = { "Access-Control-Allow-Origin": origins.has(origin) ? origin : "https://fnb-system-staging.vercel.app", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.has(origin)) return json({ error: "Origin denied." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (Deno.env.get("SUPABASE_URL") !== "https://ujkzdaaadnvcfayuldmh.supabase.co") return json({ error: "Staging only." }, 503);
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("authorization") || "" } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error: authError } = await client.auth.getUser();
  if (authError || !user.user) return json({ error: "Sign in is required." }, 401);
  const text = await request.text();
  if (text.length > 4096) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || Object.keys(body).some((key) => !["identity_id", "credential"].includes(key)) || typeof body.identity_id !== "string") return json({ error: "Invalid request." }, 400);
  const { data: configuration, error } = await client.rpc("external_agents_authorize_management", { p_identity_id: body.identity_id });
  if (error) return json({ error: "Role Settings edit authority for this agent is required." }, 403);
  if (configuration?.endpoint !== endpoint) return json({ error: "Connection adapter is unavailable." }, 400);
  const credential = body.credential || "";
  if (typeof credential !== "string" || (credential && !/^fxm_[A-Za-z0-9_-]{43}$/.test(credential))) return json({ error: "Credential format is invalid." }, 400);
  try {
    if (!credential) {
      const probe = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "FeedX endpoint check", version: "1" } } }) });
      return json({ outcome: probe.status === 401 ? "reachable" : "failed", authenticated: false, message: probe.status === 401 ? "Endpoint reachable. An agent credential is still required; this does not confirm the external agent is connected." : "Endpoint did not return the expected authentication challenge." });
    }
    const validation = await client.rpc("external_agents_validate_probe", { p_identity_id: body.identity_id, p_token: credential });
    if (validation.error) return json({ error: "Credential is not valid for this agent." }, 403);
    const probeHeaders = { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", "x-feedx-probe": await signProbe(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, credential) };
    for (const [index, method] of ["initialize", "tools/list"].entries()) {
      const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: probeHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: index + 1, method, params: method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "FeedX Admin test", version: "1" } } : {} }) });
      const result = await response.json();
      if (!response.ok || result.error || (method === "tools/list" && (result.result?.tools?.length !== configuration.tools.length || result.result.tools.some((tool: { name: string }) => !configuration.tools.some((expected: { name: string }) => expected.name === tool.name))))) throw new Error("Probe failed.");
    }
    return json({ outcome: "verified", authenticated: true, message: "Credential authenticated and all five read-only MCP tools were discovered. This FeedX test does not verify the external provider's own connection." });
  } catch { return json({ error: "Connection test failed. Check the endpoint and try again." }, 502); }
});
