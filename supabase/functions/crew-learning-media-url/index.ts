import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

const isUuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("PROJECT_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Learning media is not configured." }, 500);

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const mediaId = body.media_id;
  if (!token || !isUuid(mediaId)) return json({ error: "Learning media request is invalid." }, 400);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: access, error: accessError } = await userClient.rpc("crew_learning_media_access", {
    p_token: token,
    p_media_id: mediaId,
  });
  if (accessError || !access?.bucket || !access?.object_path) {
    return json({ error: "Learning media is unavailable." }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signedError } = await adminClient.storage
    .from(access.bucket)
    .createSignedUrl(access.object_path, 300);
  if (signedError || !signed?.signedUrl) return json({ error: "Unable to load this learning image." }, 500);

  return json({
    media_id: access.id,
    signed_url: signed.signedUrl,
    expires_in: 300,
    mime_type: access.mime_type,
    width: access.width,
    height: access.height,
  });
});
