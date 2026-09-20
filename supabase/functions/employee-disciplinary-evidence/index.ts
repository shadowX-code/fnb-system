import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const maxBytes = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Supporting evidence is temporarily unavailable." }, 500);
  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const storage = createClient(url, serviceKey);

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const warningId = String(form.get("warning_id") || "");
      const requestId = String(form.get("request_id") || "");
      const file = form.get("file") instanceof File ? form.get("file") as File : null;
      if (!uuidPattern.test(warningId) || !uuidPattern.test(requestId) || !file || !allowedTypes.has(file.type) || !file.size || file.size > maxBytes) {
        return reply({ error: "Choose one JPG, PNG, WebP, or PDF file up to 10 MB." }, 400);
      }
      const { data: context, error: contextError } = await caller.rpc("employee_disciplinary_evidence_prepare", { p_warning_id: warningId, p_request_id: requestId });
      if (contextError || !context?.bucket || !context?.object_path) return reply({ error: "This draft warning is unavailable." }, 403);
      const { error: uploadError } = await storage.storage.from(context.bucket).upload(context.object_path, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
      if (uploadError && !/already exists/i.test(uploadError.message || "")) return reply({ error: "The supporting evidence could not be uploaded. Try again." }, 500);
      const { data, error } = await caller.rpc("employee_disciplinary_evidence_finalize", {
        p_warning_id: warningId,
        p_request_id: requestId,
        p_evidence_path: context.object_path,
        p_mime_type: file.type,
        p_size_bytes: file.size,
      });
      if (error) {
        await storage.storage.from(context.bucket).remove([context.object_path]);
        return reply({ error: "The evidence could not be attached. Your warning remains a draft." }, 500);
      }
      if (context.previous_path && context.previous_path !== context.object_path) await storage.storage.from(context.bucket).remove([context.previous_path]);
      return reply(data || { warning_id: warningId });
    }

    const body = await request.json();
    const warningId = String(body?.warning_id || "");
    if (!uuidPattern.test(warningId)) return reply({ error: "Evidence was not found." }, 400);
    const crewRead = body?.action === "crew_read";
    const rpc = crewRead ? "crew_employee_disciplinary_evidence_context" : "employee_disciplinary_admin_evidence_context";
    const args = crewRead ? { p_token: String(body?.token || ""), p_warning_id: warningId } : { p_warning_id: warningId };
    const { data: context, error } = await caller.rpc(rpc, args);
    if (error || !context?.bucket || !context?.object_path) return reply({ error: "Evidence is unavailable." }, 403);
    const { data: signed, error: signError } = await storage.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 10);
    if (signError || !signed?.signedUrl) return reply({ error: "Evidence is unavailable." }, 500);
    return reply({ evidence_url: signed.signedUrl, mime_type: context.mime_type });
  } catch {
    return reply({ error: "The evidence request could not be completed." }, 400);
  }
});
