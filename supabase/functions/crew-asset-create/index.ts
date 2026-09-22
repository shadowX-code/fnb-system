import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const maxVariantBytes = 8 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function readableError(error: unknown, fallback: string) {
  const message = String((error as { message?: string })?.message || "");
  if (/asset code is already in use/i.test(message)) return "That Asset Code is already in use for this outlet.";
  if (/active asset category/i.test(message)) return "Choose an active Asset Category.";
  if (/special access/i.test(message)) return "You no longer have access to add Assets.";
  return fallback;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return reply({ error: "Asset creation is temporarily unavailable." }, 500);

  let token = "";
  let requestId = "";
  let asset: Record<string, unknown> = {};
  let original: File | null = null;
  let display: File | null = null;
  let thumbnail: File | null = null;
  try {
    const form = await request.formData();
    token = String(form.get("token") || "").trim();
    requestId = String(form.get("request_id") || "").trim();
    asset = JSON.parse(String(form.get("asset") || "{}"));
    original = form.get("original") instanceof File ? form.get("original") as File : null;
    display = form.get("display") instanceof File ? form.get("display") as File : null;
    thumbnail = form.get("thumbnail") instanceof File ? form.get("thumbnail") as File : null;
  } catch {
    return reply({ error: "The Asset details or photo could not be read. Please try again." }, 400);
  }
  if (!token || !uuidPattern.test(requestId) || !original || !display || !thumbnail) {
    return reply({ error: "Asset details and a complete photo are required." }, 400);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(original.type)
    || display.type !== 'image/webp' || thumbnail.type !== 'image/webp'
    || !original.size || !display.size || !thumbnail.size
    || original.size > maxVariantBytes || display.size > maxVariantBytes || thumbnail.size > maxVariantBytes) {
    return reply({ error: "That photo could not be prepared. Choose another photo and try again." }, 400);
  }

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const crewClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: prior, error: priorError } = await crewClient.rpc("crew_asset_create_result", { p_token: token, p_request_id: requestId });
  if (priorError) return reply({ error: "Asset creation access is unavailable." }, 403);
  if (prior) return reply(prior);

  const { data: context, error: contextError } = await crewClient.rpc("crew_asset_create_context", { p_token: token });
  if (contextError || !context?.bucket || !context?.outlet_id) return reply({ error: "Asset creation access is unavailable." }, 403);

  const storageClient = createClient(url, serviceRoleKey);
  const prefix = `asset_master/${context.outlet_id}/create/${requestId}`;
  const objects = [
    { path: `${prefix}/original.${original.type === 'image/png' ? 'png' : original.type === 'image/webp' ? 'webp' : 'jpg'}`, file: original },
    { path: `${prefix}/display.webp`, file: display },
    { path: `${prefix}/thumbnail.webp`, file: thumbnail },
  ];
  const uploaded: string[] = [];
  try {
    for (const object of objects) {
      const { error } = await storageClient.storage.from(context.bucket).upload(object.path, object.file, {
        cacheControl: "31536000", contentType: object.file.type, upsert: true,
      });
      if (error) throw error;
      uploaded.push(object.path);
    }
    const urls = objects.map((object) => storageClient.storage.from(context.bucket).getPublicUrl(object.path).data.publicUrl);
    const { data, error } = await crewClient.rpc("crew_asset_create_with_photo", {
      p_token: token, p_request_id: requestId, p_asset: asset,
      p_original_image_url: urls[0], p_image_url: urls[1], p_thumbnail_url: urls[2],
    });
    if (error) throw error;
    return reply(data || {});
  } catch (error) {
    if (uploaded.length) await storageClient.storage.from(context.bucket).remove(uploaded);
    return reply({ error: readableError(error, "We could not create that Asset with its photo. Your details are still here; try Create Asset again.") }, 500);
  }
});
