import {safeRestaurantRpcError} from './restaurant.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { createHandler, safeFactoryRpcError } from "./protocol.js";
import { isAdminProbe, tokenHash } from "../_shared/externalAgentProbe.js";
import { externalAgentEnvironment } from "../_shared/externalAgentEnvironment.js";

// Business operations use the anonymous client; the database validates the machine credential.
const url = Deno.env.get("SUPABASE_URL") || "";
const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
const environment = externalAgentEnvironment(url);
// Service authority is used only for safe access telemetry; business operations stay token-gated.
const telemetrySecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const telemetry = createClient(url, telemetrySecret, { auth: { persistSession: false, autoRefreshToken: false } });
const handler = createHandler(async (token: string, tool: string, args: Record<string, unknown>) => {
  const { data, error } = tool === "authorize"
    ? await client.rpc("factory_agent_authorize", { p_token: token })
    : tool==='query_restaurant_resources'?await client.rpc('restaurant_agent_resource_query',{p_token:token,...args})
    : tool==='restaurant_action_context'?await client.rpc('restaurant_agent_action_context',{p_token:token,...args})
    : await client.rpc(tool==='execute_restaurant_action'?'factory_agent_execute_action':tool === "execute_factory_action" ? "factory_agent_execute_action" : tool === "factory_action_context" ? "factory_agent_action_context" : "factory_agent_resource_query", { p_token: token, ...args });
  if (error) throw (['query_restaurant_resources','restaurant_action_context','execute_restaurant_action'].includes(tool)?safeRestaurantRpcError(error):safeFactoryRpcError(error));
  return data;
}, { observe: async (token: string, event: Record<string, unknown>, request: Request) => {
  const source = await isAdminProbe(telemetrySecret, token, request.headers.get("x-feedx-probe") || "") ? "admin_probe" : "external";
  const { error } = event.tool === "query_factory_resources"
    ? await telemetry.rpc("external_agents_record_resource_access", { p_token_hash: await tokenHash(token), p_outcome: event.outcome, p_reason: event.reason, p_source: source, p_resource_actions: event.resource_actions || [] })
    : event.tool==='query_restaurant_resources'?await telemetry.rpc('external_agents_record_scoped_resource_access',{p_tool:'query_restaurant_resources',p_token_hash:await tokenHash(token),p_outcome:event.outcome,p_reason:event.reason,p_source:source,p_resource_actions:event.resource_actions||[]})
    : await telemetry.rpc("external_agents_record_access", { p_token_hash: await tokenHash(token), p_method: event.method, p_tool: event.tool, p_outcome: event.outcome, p_reason: event.reason, p_source: source });
  if (error) throw new Error("Access telemetry unavailable.");
} });
Deno.serve((request: Request) => !environment
  ? new Response("Gateway environment unavailable.", { status: 503 })
  : handler(request));
