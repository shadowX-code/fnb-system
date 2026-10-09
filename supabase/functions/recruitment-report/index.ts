import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import {
  instructionsForVersion,
  reportSchemaForVersion,
  validateReport,
} from "./report.ts";
import { classifyReportFailure } from "./diagnostics.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!,
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = createClient(url, key, { auth: { persistSession: false } });
  const rpc = async (name: string, args: any) => {
    const { data, error } = await service.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  };
  let claim: any;
  let stage = "claim";
  let providerStatus: number | undefined;
  let responseId: string | undefined;
  try {
    const input = await req.json(),
      authorization = req.headers.get("authorization");
    let reportId;
    if (authorization === `Bearer ${key}`) {
      reportId = input.report_id;
    } else {
      if (!authorization)
        return json({ error: "Manager access required" }, 401);
      const caller = createClient(url, anon, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const { data, error } = await caller.rpc("recruitment_report_prepare", {
        p_application_id: input.application_id,
        p_request_id: input.request_id,
        p_new_version: input.new_version === true,
        p_attempt_id: input.attempt_id || null,
      });
      if (error) return json({ error: error.message }, 403);
      reportId = data;
    }
    claim = await rpc("recruitment_report_claim", { p_report_id: reportId });
    if (claim.status !== "claimed")
      return json({ report_id: reportId, status: claim.status });
    stage = "provider";
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw Error("Provider unavailable");
    // No candidate profile, employee data, recording URLs, audio or video enter the model.
    const source = claim.source;
    const provider = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: claim.model,
        store: false,
        instructions: instructionsForVersion(claim.prompt_version),
        input: JSON.stringify({
          attempt: source.attempt,
          config: source.config,
          turns: source.turns,
          topics: source.topics,
          scenarios: source.scenarios,
          annotations: source.annotations,
          gaps: source.gaps,
          ...(source.assessment_plan ? { assessment_plan: source.assessment_plan } : {}),
        }),
        text: {
          format: {
            type: "json_schema",
            name: "recruitment_interview_report",
            strict: true,
            schema: reportSchemaForVersion(claim.prompt_version),
          },
        },
        max_output_tokens: 9000,
      }),
    });
    providerStatus = provider.status;
    if (!provider.ok) throw Error("Provider request failed");
    stage = "response_parsing";
    const output = await provider.json();
    responseId = output.id;
    if (output.status !== "completed")
      throw Error("Provider report incomplete");
    const text = output.output
      ?.flatMap((x: any) => x.content || [])
      .filter((x: any) => x.type === "output_text")
      .map((x: any) => x.text)
      .join("");
    const parsed = JSON.parse(text);
    stage = "validation";
    const body = validateReport(parsed, source, claim.prompt_version);
    stage = "persistence";
    await rpc("recruitment_report_finish", {
      p_report_id: claim.id,
      p_generation_id: claim.generation_id,
      p_body: { ...body, provider_model: output.model },
      p_response_id: output.id,
      p_error_code: null,
    });
    return json({ report_id: claim.id, status: "ready" });
  } catch (error) {
    const code = classifyReportFailure(stage, error, providerStatus);
    // Only bounded stage/code/status metadata. Never log prompts, transcript, output or raw errors.
    console.error(JSON.stringify({event:"recruitment_report_failure",stage,code,provider_status:providerStatus}));
    if (claim?.status === "claimed")
      await rpc("recruitment_report_finish", {
        p_report_id: claim.id,
        p_generation_id: claim.generation_id,
        p_body: null,
        p_response_id: responseId || null,
        p_error_code: code,
      }).catch(() => console.error(JSON.stringify({event:"recruitment_report_failure",stage:"failure_persistence",code:"persistence_failed"})));
    return json(
      {
        error_code: code,
        error:
          "Report unavailable. Existing evidence is retained; a manager can request a new version.",
      },
      503,
    );
  }
});
