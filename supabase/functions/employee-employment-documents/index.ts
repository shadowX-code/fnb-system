import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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
const pdfPage = { width: 595.28, height: 841.89, margin: 52 };

function displayDate(value: unknown) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 }).format(Number(value || 0));
}

function contractTokenValues(manifest: Record<string, any>) {
  const entity = manifest.legal_entity || {};
  const employee = manifest.employee || {};
  const document = manifest.document || {};
  const terms = manifest.terms || {};
  const context = terms.employee_context || {};
  const allowances = Array.isArray(terms.allowances) && terms.allowances.length
    ? terms.allowances.map((item: Record<string, unknown>) => `${item.name}: ${formatMoney(item.amount)}`).join("\n")
    : "None";
  return {
    "legal_entity.legal_company_name": entity.legal_company_name || "",
    "legal_entity.company_registration_no": entity.company_registration_no || "",
    "legal_entity.registered_address": entity.registered_address || "",
    "legal_entity.display_name": entity.display_name || entity.legal_company_name || "",
    "employee.full_name": employee.full_name || "",
    "employee.employee_code": employee.employee_code || "",
    "contract.title": document.title || "Employment Contract",
    "contract.position": context.position || "",
    "contract.workplace": context.workplace || "",
    "contract.employment_type": context.employment_type || "",
    "contract.commencement_date": displayDate(context.commencement_date),
    "contract.effective_date": displayDate(terms.effective_date || document.effective_date),
    "contract.basic_salary": formatMoney(terms.basic_salary),
    "contract.salary_payment_period": terms.salary_payment_period || "",
    "contract.probation": Number(terms.probation_months || 0) ? `${terms.probation_months} month(s)` : "No probation period",
    "contract.working_days": `${terms.working_days_per_week || ""} days per week${terms.working_days_description ? ` — ${terms.working_days_description}` : ""}`,
    "contract.normal_working_hours": `${terms.normal_hours_per_day || ""} hours per day${terms.normal_hours_description ? ` — ${terms.normal_hours_description}` : ""}`,
    "contract.rest_days": Array.isArray(terms.rest_days) ? terms.rest_days.join(", ") : "",
    "contract.notice_period": `${terms.notice_period_value || ""} ${terms.notice_period_unit || ""}`.trim(),
    "contract.additional_terms": terms.additional_terms || "",
    allowances_table: allowances,
  };
}

function replaceContractTokens(body: string, values: Record<string, string>) {
  return body.replace(/\{\{([a-z_]+(?:\.[a-z_]+)?)\}\}/g, (_match, token) => values[token] ?? "");
}

function wrapText(text: string, font: any, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { result.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else { result.push(line); line = word; }
    }
    if (line) result.push(line);
  }
  return result;
}

async function renderContractPdf(manifest: Record<string, any>) {
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([pdfPage.width, pdfPage.height]);
  let y = pdfPage.height - pdfPage.margin;
  const width = pdfPage.width - pdfPage.margin * 2;
  const newPage = () => { page = pdf.addPage([pdfPage.width, pdfPage.height]); y = pdfPage.height - pdfPage.margin; };
  const ensure = (height: number) => { if (y - height < pdfPage.margin) newPage(); };
  const drawLines = (text: string, font: any, size: number, lineHeight: number, colour = rgb(0.06, 0.15, 0.16)) => {
    const lines = wrapText(text, font, size, width);
    ensure(Math.max(lineHeight, lines.length * lineHeight));
    for (const line of lines) { page.drawText(line, { x: pdfPage.margin, y, size, font, color: colour }); y -= lineHeight; }
  };
  const entity = manifest.legal_entity || {};
  const template = manifest.template || {};
  const values = contractTokenValues(manifest);
  page.drawText(entity.display_name || entity.legal_company_name || "Legal Employer", { x: pdfPage.margin, y, size: 10, font: sans, color: rgb(0.18, 0.34, 0.33) });
  y -= 32;
  const title = manifest.document?.title || "Employment Contract";
  page.drawText(title, { x: pdfPage.margin, y, size: 22, font: serifBold, color: rgb(0.04, 0.13, 0.14) });
  y -= 22;
  page.drawText(`Template: ${template.title || "Employment Contract"} · Version ${template.version_number || ""}`, { x: pdfPage.margin, y, size: 9, font: sans, color: rgb(0.33, 0.40, 0.40) });
  y -= 25;
  const sections = Array.isArray(template.sections) ? template.sections : [];
  for (const section of sections) {
    const heading = String(section.heading || "");
    const body = replaceContractTokens(String(section.body || ""), values);
    ensure(30);
    page.drawText(heading, { x: pdfPage.margin, y, size: 12, font: serifBold, color: rgb(0.04, 0.13, 0.14) });
    y -= 17;
    drawLines(body, serif, 10.5, 15.5);
    y -= 10;
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => item.drawText(`Employment Contract · ${index + 1} / ${pages.length}`, { x: pdfPage.margin, y: 28, size: 8, font: sans, color: rgb(0.35, 0.42, 0.42) }));
  return pdf.save();
}

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
    if (body?.action === "contract_preview") {
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData.user?.id) return reply({ error: "Your Admin session is unavailable." }, 401);
      const { data: context, error: contextError } = await caller.rpc("employee_employment_contract_render_context", { p_document_id: documentId });
      if (contextError || !context?.manifest || !context?.object_path || !context?.bucket) return reply({ error: "Template contract draft is unavailable." }, 403);
      const bytes = await renderContractPdf(context.manifest);
      if (!bytes.byteLength || bytes.byteLength > maxBytes) return reply({ error: "The generated contract exceeds the 10 MB document limit." }, 400);
      const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
      const { error: uploadError } = await service.storage.from(context.bucket).upload(context.object_path, bytes, { cacheControl: "31536000", contentType: "application/pdf", upsert: true });
      if (uploadError) return reply({ error: "The contract preview could not be generated. Try again." }, 500);
      const { data: finalized, error: finalizeError } = await service.rpc("employee_employment_contract_render_finalize_service", {
        p_document_id: documentId,
        p_document_path: context.object_path,
        p_size_bytes: bytes.byteLength,
        p_pdf_sha256: sha256,
        p_manifest_sha256: context.manifest_sha256,
        p_actor_auth_user_id: userData.user.id,
      });
      if (finalizeError) return reply({ error: "The contract changed while it was being rendered. Review and generate it again." }, 409);
      const [{ data: view }, { data: download }] = await Promise.all([
        service.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 5),
        service.storage.from(context.bucket).createSignedUrl(context.object_path, 60 * 5, { download: context.file_name || "employment-contract.pdf" }),
      ]);
      if (!view?.signedUrl || !download?.signedUrl) return reply({ error: "The generated contract preview is unavailable." }, 500);
      return reply({ ...finalized, document_url: view.signedUrl, download_url: download.signedUrl, file_name: context.file_name });
    }
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
