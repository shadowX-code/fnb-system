import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { createHandler } from "./protocol.js";
import { isAdminProbe, tokenHash } from "../_shared/externalAgentProbe.js";

// Business reads use the anonymous client; the database validates the machine credential.
const url = Deno.env.get("SUPABASE_URL") || "";
const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
const staging = "https://ujkzdaaadnvcfayuldmh.supabase.co";
// Service authority is used only for safe access telemetry; business reads stay token-gated.
const telemetrySecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const telemetry = createClient(url, telemetrySecret, { auth: { persistSession: false, autoRefreshToken: false } });
const handler = createHandler(async (token: string, tool: string, args: Record<string, unknown>) => {
  const { data, error } = tool === "query_mesti_resources"
    ? await client.rpc("factory_mesti_resource_query", { p_token: token, ...args })
    : await client.rpc("factory_mesti_inspection", { p_token: token, p_tool: tool, ...args });
  if (error) throw Object.assign(new Error("Inspection denied or unavailable."), { code: error.code });
  return data;
}, { observe: async (token: string, event: Record<string, unknown>, request: Request) => {
  const source = await isAdminProbe(telemetrySecret, token, request.headers.get("x-feedx-probe") || "") ? "admin_probe" : "external";
  const { error } = event.tool === "query_mesti_resources"
    ? await telemetry.rpc("external_agents_record_resource_access", { p_token_hash: await tokenHash(token), p_outcome: event.outcome, p_reason: event.reason, p_source: source, p_resource_actions: event.resource_actions || [] })
    : await telemetry.rpc("external_agents_record_access", { p_token_hash: await tokenHash(token), p_method: event.method, p_tool: event.tool, p_outcome: event.outcome, p_reason: event.reason, p_source: source });
  if (error) throw new Error("Access telemetry unavailable.");
} });
Deno.serve((request: Request) => url !== staging
  ? new Response("Staging connector only.", { status: 503 })
  : handler(request));
