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
  if (value === null || value === undefined || value === "") return "Not provided";
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 }).format(Number(value || 0));
}

function base64(bytes: Uint8Array) {
  let text = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) text += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(text);
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
    "employee.ic_no": employee.ic_no || "Not recorded",
    "employee.residential_address": employee.residential_address || "Not recorded",
    "contract.title": document.title || "Employment Contract",
    "contract.contract_date": displayDate(terms.contract_date || terms.effective_date || document.effective_date),
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
    "contract.probation_notice_period": `${terms.probation_notice_period_value || terms.notice_period_value || ""} ${terms.probation_notice_period_unit || terms.notice_period_unit || ""}`.trim(),
    "contract.confirmed_notice_period": `${terms.confirmed_notice_period_value || terms.notice_period_value || ""} ${terms.confirmed_notice_period_unit || terms.notice_period_unit || ""}`.trim(),
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
  const drawTable = (headers: string[], rows: string[][], widths: number[]) => {
    const rowHeight = 20;
    const drawRow = (cells: string[], isHeader = false) => {
      ensure(rowHeight);
      let x = pdfPage.margin;
      cells.forEach((cell, index) => {
        page.drawRectangle({ x, y: y - rowHeight + 3, width: widths[index], height: rowHeight, borderColor: rgb(0.78, 0.82, 0.81), borderWidth: 0.5, color: isHeader ? rgb(0.92, 0.95, 0.94) : rgb(1, 1, 1) });
        page.drawText(cell, { x: x + 6, y: y - 13, size: isHeader ? 8.5 : 8.5, font: isHeader ? sans : serif, color: rgb(0.06, 0.15, 0.16) });
        x += widths[index];
      });
      y -= rowHeight;
    };
    ensure(rowHeight * 2 + 8);
    drawRow(headers, true);
    rows.forEach((row) => {
      if (y - rowHeight < pdfPage.margin) { newPage(); drawRow(headers, true); }
      drawRow(row);
    });
    y -= 10;
  };
  const drawAnnualLeaveTable = () => drawTable(["Length of service", "Paid annual leave"], [["Less than 2 years", "8 working days"], ["2 to 5 years", "12 working days"], ["5 years or more", "16 working days"]], [width * 0.58, width * 0.42]);
  const drawSickHospitalisationLeaveTable = () => drawTable(["Length of service", "Paid sick leave", "Hospitalisation leave"], [["Less than 2 years", "14 days", "60 days"], ["2 to 5 years", "18 days", "60 days"], ["5 years or more", "22 days", "60 days"]], [width * 0.40, width * 0.28, width * 0.32]);
  const drawSignatureBlock = () => {
    const terms = manifest.terms || {};
    ensure(145);
    const columnWidth = (width - 24) / 2;
    const column = (x: number, heading: string, name: string, detail: string) => {
      page.drawText(heading, { x, y, size: 10, font: serifBold, color: rgb(0.04, 0.13, 0.14) });
      y -= 50;
      page.drawLine({ start: { x, y }, end: { x: x + columnWidth, y }, thickness: 0.7, color: rgb(0.36, 0.43, 0.42) });
      y -= 14;
      page.drawText(`Name: ${name || ""}`, { x, y, size: 8.5, font: sans, color: rgb(0.06, 0.15, 0.16) });
      y -= 13;
      page.drawText(detail, { x, y, size: 8.5, font: sans, color: rgb(0.06, 0.15, 0.16) });
      y -= 13;
      page.drawText("Signature: ____________________", { x, y, size: 8.5, font: sans, color: rgb(0.06, 0.15, 0.16) });
      y -= 13;
      page.drawText("Date: ________________________", { x, y, size: 8.5, font: sans, color: rgb(0.06, 0.15, 0.16) });
    };
    const startY = y;
    column(pdfPage.margin, "For and on behalf of Employer", terms.employer_signatory_name || "", `Designation: ${terms.employer_signatory_designation || ""}`);
    const employerEndY = y;
    y = startY;
    column(pdfPage.margin + columnWidth + 24, "Employee", manifest.employee?.full_name || "", `NRIC/Passport: ${manifest.employee?.ic_no || "Not recorded"}`);
    y = Math.min(employerEndY, y) - 8;
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
    ensure(50);
    page.drawText(heading, { x: pdfPage.margin, y, size: 12, font: serifBold, color: rgb(0.04, 0.13, 0.14) });
    y -= 17;
    const blocks = String(section.body || "").split(/(\{\{(?:annual_leave_table|sick_hospitalisation_leave_table|signature_block)\}\})/g);
    for (const block of blocks) {
      if (block === "{{annual_leave_table}}") drawAnnualLeaveTable();
      else if (block === "{{sick_hospitalisation_leave_table}}") drawSickHospitalisationLeaveTable();
      else if (block === "{{signature_block}}") drawSignatureBlock();
      else if (block.trim()) drawLines(replaceContractTokens(block, values), serif, 10.5, 15.5);
    }
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
    if (body?.action === "template_preview") {
      const legalEntityId = String(body?.legal_entity_id || "");
      const employeeId = String(body?.employee_id || "");
      if (!uuidPattern.test(legalEntityId) || !uuidPattern.test(employeeId) || !body?.template) return reply({ error: "Choose a legal employer, employee and valid template draft." }, 400);
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData.user?.id) return reply({ error: "Your Admin session is unavailable." }, 401);
      const { data: manifest, error: contextError } = await caller.rpc("employment_contract_template_preview_context", {
        p_legal_entity_id: legalEntityId,
        p_employee_id: employeeId,
        p_payload: body.template,
      });
      if (contextError || !manifest) return reply({ error: "The draft template preview is unavailable. Review the required template fields and employee scope." }, 403);
      const bytes = await renderContractPdf(manifest);
      if (!bytes.byteLength || bytes.byteLength > maxBytes) return reply({ error: "The generated contract exceeds the 10 MB document limit." }, 400);
      return reply({
        preview_pdf_base64: base64(bytes),
        file_name: `${String(manifest.document?.title || "employment-contract").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`,
        missing_variables: manifest.missing_variables || [],
        preview: true,
      });
    }
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
