import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const allowedOriginalTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function originalExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return response({ error: "Asset photo service is unavailable." }, 500);

  let token = "";
  let assetId = "";
  let requestId = "";
  let original: File | null = null;
  let display: File | null = null;
  let thumbnail: File | null = null;
  try {
    const form = await request.formData();
    token = String(form.get("token") || "").trim();
    assetId = String(form.get("asset_id") || "").trim();
    requestId = String(form.get("request_id") || "").trim();
    const originalValue = form.get("original");
    const displayValue = form.get("display");
    const thumbnailValue = form.get("thumbnail");
    original = originalValue instanceof File ? originalValue : null;
    display = displayValue instanceof File ? displayValue : null;
    thumbnail = thumbnailValue instanceof File ? thumbnailValue : null;
  } catch {
    return response({ error: "Invalid asset photo request." }, 400);
  }
  if (!token || !assetId || !requestId || !original || !display || !thumbnail || !uuidPattern.test(requestId)) return response({ error: "Crew session, asset, request and photo bundle are required." }, 400);
  if (!allowedOriginalTypes.has(original.type) || original.size === 0 || original.size > maxBytes
    || display.type !== "image/webp" || thumbnail.type !== "image/webp"
    || display.size === 0 || thumbnail.size === 0 || display.size > maxBytes || thumbnail.size > maxBytes) return response({ error: "Choose a JPG, PNG, or WebP image up to 5 MB." }, 400);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const crewClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: prior, error: priorError } = await crewClient.rpc("crew_asset_initial_photo_result", { p_token: token, p_request_id: requestId });
  if (priorError) return response({ error: "Initial asset photo access is unavailable." }, 403);
  if (prior) return response(prior);
  const storageClient = createClient(url, serviceRoleKey);
  const { data: context, error: contextError } = await crewClient.rpc("crew_asset_initial_photo_context", { p_token: token, p_asset_id: assetId });
  if (contextError || !context?.bucket || context.asset_id !== assetId) return response({ error: "Initial asset photo access is unavailable." }, 403);

  const prefix = `asset_master/${context.outlet_id}/${assetId}/${requestId}`;
  const objects = [
    { key: "original", path: `${prefix}/original.${originalExtension(original)}`, file: original },
    { key: "display", path: `${prefix}/display.webp`, file: display },
    { key: "thumbnail", path: `${prefix}/thumbnail.webp`, file: thumbnail },
  ];
  const uploadedPaths: string[] = [];
  for (const object of objects) {
    const { error: uploadError } = await storageClient.storage.from(context.bucket).upload(object.path, object.file, {
      cacheControl: "31536000",
      contentType: object.file.type,
      upsert: true,
    });
    if (uploadError) {
      if (uploadedPaths.length) await storageClient.storage.from(context.bucket).remove(uploadedPaths);
      return response({ error: "Unable to upload asset photo." }, 500);
    }
    uploadedPaths.push(object.path);
  }
  const urls = Object.fromEntries(objects.map((object) => [object.key, storageClient.storage.from(context.bucket).getPublicUrl(object.path).data.publicUrl]));

  const { data, error } = await crewClient.rpc("crew_asset_set_initial_photo", {
    p_token: token,
    p_request_id: requestId,
    p_asset_id: assetId,
    p_original_image_url: urls.original,
    p_image_url: urls.display,
    p_thumbnail_url: urls.thumbnail,
  });
  // Do not remove an uploaded bundle after an uncertain attachment result: a
  // same-request retry can safely complete or recover its durable result.
  if (error) return response({ error: "Unable to attach asset photo." }, 500);
  return response(data || {});
});
