import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { parseHTML } from "npm:linkedom@0.18.12";
import { directories, discoverDocuments, boundedFetch } from "./discovery.js";
import { parseOfficialPages } from './parser.js';
import { readPdfPages } from './pdf.ts';

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("Authorization") || "" } } });
  try {
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return reply({ error: "Sign in to check official updates." }, 401);
    if (Number(request.headers.get("content-length")) > 2048) return reply({ error: "Invalid check request." }, 400);
    const body = await request.json();
    const { data: check, error } = await caller.rpc("payroll_holiday_update_check_begin", { p_year: Number(body.year), p_geography: body.geography, p_request_id: body.requestId });
    if (error) return reply({ error: error.message }, 403);
    if (check.completed_at) return reply(check.result);
    const trusted = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const sources: Array<Record<string, unknown>> = []; const updates: Array<Record<string, unknown>> = [];
    let incomplete = false;
    for (const directory of directories) {
      try {
        const html = new TextDecoder().decode(await boundedFetch(directory, false));
        const documents = discoverDocuments(parseHTML(html).document, directory, check.year, check.geography);
        for (const document of documents) {
          try {
            const bytes = await boundedFetch(document.url, true);
            let binary = ""; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
            const { data: candidate, error: captureError } = await caller.rpc("payroll_holiday_discovered_source_capture", {
              p_year: check.year, p_url: document.url, p_reference: document.name,
              p_filename: new URL(document.url).pathname.split("/").pop(), p_pdf_base64: btoa(binary), p_request_id: crypto.randomUUID(),
            });
            if (captureError) throw captureError;
            if (candidate.status === 'fetched') {
              const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
              try {
                const proposal=parseOfficialPages(await readPdfPages(bytes),check.year,hash);
                const {error:proposalError}=await trusted.rpc('payroll_holiday_candidate_propose',{p_id:candidate.id,p_check_id:check.id,p_source_sha256:hash,p_rows:proposal.rows,p_metadata:proposal.metadata});
                if(proposalError) throw proposalError;
                candidate.status='needs_review';
              } catch (cause) {
                const message=cause instanceof Error?cause.message:'PDF extraction could not be completed. Review the captured source manually.';
                const {error:failure}=await trusted.rpc('payroll_holiday_candidate_proposal_failure',{p_id:candidate.id,p_check_id:check.id,p_message:message});
                if(failure) throw failure;
                sources.push({url:document.url,status:'review_required',reason:message});
              }
            }
            updates.push({ ...candidate, name: document.name, source: directory, document_url: document.url });
          } catch { incomplete = true; sources.push({ url: document.url, status: "unavailable" }); }
        }
        sources.push({ url: directory, status: "checked", documents: documents.length });
      } catch { incomplete = true; sources.push({ url: directory, status: "unavailable" }); }
    }
    // A supplementary declaration can be resolved by the existing entitlement
    // authority without publishing it as a replacement annual calendar.
    const { data: reviewed, error: readError } = await caller.rpc("payroll_holiday_candidate_read", { p_year: check.year, p_include_qa: false });
    if (readError) incomplete = true;
    const pendingIds = new Set((reviewed || []).filter((c: { id: string; status: string; rows: Array<{state: string; key: string}>; additional_confirmations?: Record<string, unknown> }) => {
      const actual = (c.rows || []).filter(r => r.state !== "missing");
      return c.status !== "published" && !(actual.length && actual.every(r => c.additional_confirmations?.[r.key]));
    }).map((c: { id: string }) => c.id));
    const result = { status: incomplete ? "incomplete" : updates.some(c => c.created) ? "updates_found" : updates.some(c => pendingIds.has(c.id)) ? "review_pending" : "no_updates", sources, candidates: updates };
    const { error: finishError } = await trusted.rpc("payroll_holiday_update_check_finish", { p_id: check.id, p_result: result });
    if (finishError) return reply({ error: "Check could not be recorded. The published calendar is unchanged." }, 500);
    return reply(result);
  } catch { return reply({ error: "Unable to check official updates. The published calendar is unchanged." }, 400); }
});
