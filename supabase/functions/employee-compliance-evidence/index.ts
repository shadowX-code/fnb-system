import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const maxBytes = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
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
  if (!url || !anonKey || !serviceKey) return reply({ error: "Compliance evidence is temporarily unavailable." }, 500);

  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const storage = createClient(url, serviceKey);

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const token = String(form.get("token") || "").trim();
      const requirementCode = String(form.get("requirement_code") || "").trim();
      const expiryDate = String(form.get("expiry_date") || "").trim() || null;
      const requestId = String(form.get("request_id") || "").trim();
      const file = form.get("file") instanceof File ? form.get("file") as File : null;
      if (!token || !uuidPattern.test(requestId) || !file || !allowedTypes.has(file.type) || !file.size || file.size > maxBytes) {
        return reply({ error: "Choose one clear JPG, PNG, or WebP photo up to 10 MB." }, 400);
      }

      const { data: context, error: contextError } = await caller.rpc("crew_employee_compliance_submit_context", {
        p_token: token,
        p_requirement_code: requirementCode,
        p_expiry_date: expiryDate,
        p_request_id: requestId,
      });
      if (contextError || !context?.bucket || !context?.object_path) return reply({ error: "This compliance submission is unavailable." }, 403);

      const { error: uploadError } = await storage.storage.from(context.bucket).upload(context.object_path, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });
      if (uploadError && !/already exists/i.test(uploadError.message || "")) return reply({ error: "The photo could not be uploaded. Try again." }, 500);

      const { data, error } = await caller.rpc("crew_employee_compliance_submit_finalize", {
        p_token: token,
        p_requirement_code: requirementCode,
        p_expiry_date: expiryDate,
        p_request_id: requestId,
        p_evidence_path: context.object_path,
        p_evidence_mime_type: file.type,
        p_evidence_size_bytes: file.size,
      });
      if (error) {
        await storage.storage.from(context.bucket).remove([context.object_path]);
        return reply({ error: "The submission could not be completed. Your details are still here; try again." }, 500);
      }
      return reply(data || { status: "pending_verification" });
    }

    const body = await request.json();
    const submissionId = String(body?.submission_id || "");
    if (!uuidPattern.test(submissionId)) return reply({ error: "Evidence was not found." }, 400);
    const crewRead = body?.action === "crew_read";
    const rpc = crewRead ? "crew_employee_compliance_evidence_context" : "employee_compliance_admin_evidence_context";
    const args = crewRead ? { p_token: String(body?.token || ""), p_submission_id: submissionId } : { p_submission_id: submissionId };
    const { data: context, error } = await caller.rpc(rpc, args);
    if (error || !context?.bucket || !context?.object_path) return reply({ error: "Evidence is unavailable." }, 403);
    const { data: signed, error: signError } = await storage.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 10);
    if (signError || !signed?.signedUrl) return reply({ error: "Evidence is unavailable." }, 500);
    return reply({ evidence_url: signed.signedUrl });
  } catch {
    return reply({ error: "The compliance evidence request could not be completed." }, 400);
  }
});
