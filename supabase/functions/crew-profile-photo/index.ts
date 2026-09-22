import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const maxBytes = 5 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  if (!url || !anonKey || !serviceRoleKey) return response({ error: "Profile photo service is unavailable." }, 500);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const crewClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const storageClient = createClient(url, serviceRoleKey);
  const isUpload = (request.headers.get("content-type") || "").includes("multipart/form-data");

  let token = "";
  let upload: File | null = null;
  try {
    if (isUpload) {
      const form = await request.formData();
      token = String(form.get("token") || "").trim();
      const value = form.get("file");
      upload = value instanceof File ? value : null;
    } else {
      const body = await request.json();
      if (body?.action !== "read") return response({ error: "Unsupported profile photo action." }, 400);
      token = String(body?.token || "").trim();
    }
  } catch {
    return response({ error: "Invalid profile photo request." }, 400);
  }

  if (!token) return response({ error: "Crew session is required." }, 401);
  if (upload && (!allowedTypes.has(upload.type) || upload.size === 0 || upload.size > maxBytes)) {
    return response({ error: "Choose a JPG, PNG, or WebP image up to 5 MB." }, 400);
  }

  const { data: context, error: contextError } = await crewClient.rpc("crew_profile_photo_context", { p_token: token });
  if (contextError || !context?.bucket || !context?.object_path) return response({ error: "Crew profile photo access is unavailable." }, 403);

  if (upload) {
    const { error: uploadError } = await storageClient.storage.from(context.bucket).upload(context.object_path, upload, {
      cacheControl: "31536000",
      contentType: upload.type,
      upsert: true,
    });
    if (uploadError) return response({ error: "Unable to upload the profile photo." }, 500);

    const { data: saved, error: saveError } = await crewClient.rpc("crew_set_profile_photo", {
      p_token: token,
      p_profile_photo_path: context.object_path,
    });
    if (saveError) return response({ error: "Unable to save the profile photo." }, 403);
    context.profile_photo_path = saved?.profile_photo_path || context.object_path;
  }

  if (!context.profile_photo_path) return response({ profile_photo_path: null, profile_photo_url: null });
  const { data: signed, error: signError } = await storageClient.storage.from(context.bucket).createSignedUrl(context.profile_photo_path, 60 * 10);
  if (signError || !signed?.signedUrl) return response({ error: "Unable to read the profile photo." }, 500);
  return response({ profile_photo_path: context.profile_photo_path, profile_photo_url: signed.signedUrl });
});
