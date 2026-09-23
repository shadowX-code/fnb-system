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
  if (!url || !anonKey || !serviceRoleKey) return response({ error: "Asset evidence service is unavailable." }, 500);
  let token = "";
  let outletId = "";
  let assetId = "";
  let upload: File | null = null;
  try {
    const form = await request.formData();
    token = String(form.get("token") || "").trim();
    outletId = String(form.get("outlet_id") || "").trim();
    assetId = String(form.get("asset_id") || "").trim();
    const value = form.get("file");
    upload = value instanceof File ? value : null;
  } catch {
    return response({ error: "Invalid asset evidence request." }, 400);
  }
  if (!token || !assetId || !upload || (outletId && !/^[0-9a-f-]{36}$/i.test(outletId))) return response({ error: "Crew session, asset and photo are required." }, 400);
  if (!allowedTypes.has(upload.type) || upload.size === 0 || upload.size > maxBytes) return response({ error: "Choose a JPG, PNG, or WebP image up to 5 MB." }, 400);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const crewClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const storageClient = createClient(url, serviceRoleKey);
  const { data: context, error: contextError } = await crewClient.rpc(outletId ? "crew_management_asset_evidence_context" : "crew_asset_evidence_context", { p_token: token, p_asset_id: assetId, ...(outletId ? { p_outlet_id: outletId } : {}) });
  if (contextError || !context?.bucket || context.asset_id !== assetId) return response({ error: "Inspection evidence access is unavailable." }, 403);
  const objectPath = `inspection_evidence/${context.outlet_id}/${context.employee_id}/${assetId}-${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await storageClient.storage.from(context.bucket).upload(objectPath, upload, {
    cacheControl: "31536000",
    contentType: upload.type,
    upsert: false,
  });
  if (uploadError) return response({ error: "Unable to upload inspection evidence." }, 500);
  const { data: publicUrl } = storageClient.storage.from(context.bucket).getPublicUrl(objectPath);
  if (!publicUrl?.publicUrl) return response({ error: "Unable to resolve inspection evidence." }, 500);
  return response({ image_url: publicUrl.publicUrl, object_path: objectPath });
});
