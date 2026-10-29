import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { createHandler } from "./protocol.js";

// No service-role key: the database validates the opaque machine credential itself.
const url = Deno.env.get("SUPABASE_URL") || "";
const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
const staging = "https://ujkzdaaadnvcfayuldmh.supabase.co";
const handler = createHandler(async (token: string, tool: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc("factory_mesti_inspection", { p_token: token, p_tool: tool, ...args });
  if (error) throw new Error("Inspection denied or unavailable.");
  return data;
});
Deno.serve((request: Request) => url !== staging
  ? new Response("Staging connector only.", { status: 503 })
  : handler(request));
