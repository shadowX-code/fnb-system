import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const maxBytes = 10 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Employment documents are temporarily unavailable." }, 500);
  const authorization = request.headers.get("Authorization") || `Bearer ${anonKey}`;
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const service = createClient(url, serviceKey);

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const documentId = String(form.get("document_id") || "");
      const requestId = String(form.get("request_id") || "");
      const file = form.get("file") instanceof File ? form.get("file") as File : null;
      if (!uuidPattern.test(documentId) || !uuidPattern.test(requestId) || !file || file.type !== "application/pdf" || !file.size || file.size > maxBytes) {
        return reply({ error: "Choose one PDF file up to 10 MB." }, 400);
      }
      const bytes = await file.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return reply({ error: "The selected file is not a valid PDF." }, 400);
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData.user?.id) return reply({ error: "Your Admin session is unavailable." }, 401);
      const { data: context, error: contextError } = await caller.rpc("employee_employment_document_upload_prepare", { p_document_id: documentId, p_request_id: requestId });
      if (contextError || !context?.bucket || !context?.object_path) return reply({ error: "This draft employment document is unavailable." }, 403);
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
      const { error: uploadError } = await service.storage.from(context.bucket).upload(context.object_path, bytes, { cacheControl: "31536000", contentType: "application/pdf", upsert: false });
      if (uploadError && !/already exists/i.test(uploadError.message || "")) return reply({ error: "The employment document could not be uploaded. Try again." }, 500);
      const { data, error } = await service.rpc("employee_employment_document_upload_finalize_service", {
        p_document_id: documentId,
        p_request_id: requestId,
        p_document_path: context.object_path,
        p_size_bytes: file.size,
        p_sha256: sha256,
        p_actor_auth_user_id: userData.user.id,
      });
      if (error) {
        await service.storage.from(context.bucket).remove([context.object_path]);
        return reply({ error: "The PDF could not be attached. The employment document remains a draft." }, 500);
      }
      if (context.previous_path && context.previous_path !== context.object_path) await service.storage.from(context.bucket).remove([context.previous_path]);
      return reply(data || { document_id: documentId, document_sha256: sha256 });
    }

    const body = await request.json();
    const documentId = String(body?.document_id || "");
    if (!uuidPattern.test(documentId)) return reply({ error: "Employment document was not found." }, 400);
    const crewRead = body?.action === "crew_read";
    const rpc = crewRead ? "crew_employee_employment_document_open" : "employee_employment_document_admin_read_context";
    const args = crewRead ? { p_token: String(body?.token || ""), p_document_id: documentId } : { p_document_id: documentId };
    const { data: context, error } = await caller.rpc(rpc, args);
    if (error || !context?.bucket || !context?.object_path) return reply({ error: "Employment document is unavailable." }, 403);
    const [{ data: view }, { data: download }] = await Promise.all([
      service.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 5),
      service.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 5, { download: context.file_name || "employment-contract.pdf" }),
    ]);
    if (!view?.signedUrl || !download?.signedUrl) return reply({ error: "Employment document is unavailable." }, 500);
    return reply({ ...context, document_url: view.signedUrl, download_url: download.signedUrl });
  } catch {
    return reply({ error: "The employment document request could not be completed." }, 400);
  }
});
