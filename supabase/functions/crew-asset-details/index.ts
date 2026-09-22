import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*" };
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL"); const anon = Deno.env.get("SUPABASE_ANON_KEY"); const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "Asset details are temporarily unavailable." }, 500);
  let token = "", requestId = "", assetId = "", details: Record<string, unknown> = {}, original: File | null = null, display: File | null = null, thumbnail: File | null = null;
  try { const form = await request.formData(); token = String(form.get("token") || ""); requestId = String(form.get("request_id") || ""); assetId = String(form.get("asset_id") || ""); details = JSON.parse(String(form.get("details") || "{}")); original = form.get("original") instanceof File ? form.get("original") as File : null; display = form.get("display") instanceof File ? form.get("display") as File : null; thumbnail = form.get("thumbnail") instanceof File ? form.get("thumbnail") as File : null; } catch { return reply({ error: "The Asset details could not be read. Please try again." }, 400); }
  if (!token || !uuid.test(requestId) || !uuid.test(assetId) || (Boolean(original) !== Boolean(display) || Boolean(display) !== Boolean(thumbnail))) return reply({ error: "Asset details are incomplete. Please try again." }, 400);
  const crew = createClient(url, anon, { global: { headers: { Authorization: request.headers.get("Authorization") || `Bearer ${anon}` } } });
  let urls: (string | null)[] = [null, null, null]; let uploaded: string[] = [];
  try {
    if (original && display && thumbnail) {
      if (![original, display, thumbnail].every((file) => file!.size > 0 && file!.size <= 8 * 1024 * 1024) || display.type !== "image/webp" || thumbnail.type !== "image/webp") return reply({ error: "That photo could not be prepared. Choose another photo and try again." }, 400);
      const { data: projection, error } = await crew.rpc("crew_asset_mobile", { p_token: token, p_asset_id: assetId });
      if (error || !projection?.outlet?.id) return reply({ error: "You no longer have access to edit this Asset." }, 403);
      const storage = createClient(url, service); const prefix = `asset_master/${projection.outlet.id}/details/${requestId}`;
      const files = [{ path: `${prefix}/original.webp`, file: original }, { path: `${prefix}/display.webp`, file: display }, { path: `${prefix}/thumbnail.webp`, file: thumbnail }];
      for (const item of files) { const { error: uploadError } = await storage.storage.from("asset-photos").upload(item.path, item.file!, { cacheControl: "31536000", contentType: item.file!.type, upsert: true }); if (uploadError) throw uploadError; uploaded.push(item.path); }
      urls = files.map((item) => storage.storage.from("asset-photos").getPublicUrl(item.path).data.publicUrl);
    }
    const { data, error } = await crew.rpc("crew_asset_update_details", { p_token: token, p_request_id: requestId, p_asset_id: assetId, p_details: details, p_original_image_url: urls[0], p_image_url: urls[1], p_thumbnail_url: urls[2] });
    if (error) throw error;
    return reply(data || {});
  } catch {
    if (uploaded.length) await createClient(url, service).storage.from("asset-photos").remove(uploaded);
    return reply({ error: "We could not save those Asset details. Check the fields and try again." }, 400);
  }
});
