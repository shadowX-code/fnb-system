import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;
const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return response({ error: "Asset photo service is unavailable." }, 500);

  let token = "";
  let assetId = "";
  let upload: File | null = null;
  try {
    const form = await request.formData();
    token = String(form.get("token") || "").trim();
    assetId = String(form.get("asset_id") || "").trim();
    const value = form.get("file");
    upload = value instanceof File ? value : null;
  } catch {
    return response({ error: "Invalid asset photo request." }, 400);
  }
  if (!token || !assetId || !upload) return response({ error: "Crew session, asset and photo are required." }, 400);
  if (!allowedTypes.has(upload.type) || upload.size === 0 || upload.size > maxBytes) return response({ error: "Choose a JPG, PNG, or WebP image up to 5 MB." }, 400);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const crewClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const storageClient = createClient(url, serviceRoleKey);
  const { data: context, error: contextError } = await crewClient.rpc("crew_asset_initial_photo_context", { p_token: token, p_asset_id: assetId });
  if (contextError || !context?.bucket || context.asset_id !== assetId) return response({ error: "Initial asset photo access is unavailable." }, 403);

  const objectPath = `crew_assets/${context.outlet_id}/${context.employee_id}/${assetId}-${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await storageClient.storage.from(context.bucket).upload(objectPath, upload, {
    cacheControl: "31536000",
    contentType: upload.type,
    upsert: false,
  });
  if (uploadError) return response({ error: "Unable to upload asset photo." }, 500);
  const { data: publicUrl } = storageClient.storage.from(context.bucket).getPublicUrl(objectPath);
  if (!publicUrl?.publicUrl) return response({ error: "Unable to resolve asset photo." }, 500);

  const { data, error } = await crewClient.rpc("crew_asset_set_initial_photo", {
    p_token: token,
    p_request_id: crypto.randomUUID(),
    p_asset_id: assetId,
    p_image_url: publicUrl.publicUrl,
  });
  if (error) {
    await storageClient.storage.from(context.bucket).remove([objectPath]);
    return response({ error: "Unable to attach asset photo." }, 500);
  }
  return response({ asset: data?.asset, image_url: publicUrl.publicUrl });
});
