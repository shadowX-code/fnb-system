import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { STAGING_ORIGIN, STAGING_SUPABASE } from "../_shared/metaSecurity.ts";
import {
  normalizeInboxWebhook,
  requestInboxAI,
  verifyInboxSignature,
} from "../_shared/marketingInbox.ts";
const env = (n: string) => Deno.env.get(n) || "";
const origins = new Set([STAGING_ORIGIN, "http://localhost:5173"]);
async function rpc(db: any, name: string, args: any = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error("inbox_authority_rejected");
  return data;
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": origins.has(origin)
      ? origin
      : STAGING_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const json = (v: any, s = 200) =>
    new Response(JSON.stringify(v), {
      status: s,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  if (env("SUPABASE_URL") !== STAGING_SUPABASE) {
    return json({ error: "Staging integration only." }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  const url = new URL(req.url),
    path = url.pathname.split("/marketing-inbox")[1] || "/";
  const service = createClient(
    STAGING_SUPABASE,
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  if (path === "/webhook") {
    if (req.method === "GET") {
      const expected = env("MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN"),
        supplied = url.searchParams.get("hub.verify_token") || "",
        challenge = url.searchParams.get("hub.challenge") || "";
      if (
        expected && supplied === expected &&
        url.searchParams.get("hub.mode") === "subscribe" &&
        /^\d{1,100}$/.test(challenge)
      ) {
        return new Response(challenge, {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          },
        });
      }
      return json({ error: "Webhook verification unavailable." }, 403);
    }
    if (req.method !== "POST") {
      return json({ error: "Endpoint unavailable." }, 404);
    }
    // Stream a bounded raw body; do not trust Content-Length or parse before verification.
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Invalid webhook." }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 1048576) {
        await reader.cancel();
        return json({ error: "Webhook too large." }, 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    if (
      !await verifyInboxSignature(
        bytes,
        req.headers.get("x-hub-signature-256") || "",
        env("MARKETING_META_APP_SECRET"),
      )
    ) return json({ error: "Invalid webhook signature." }, 401);
    let events;
    try {
      events = normalizeInboxWebhook(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
    } catch {
      return json({ error: "Invalid webhook contract." }, 400);
    }
    try {
      await rpc(service, "marketing_inbox_enqueue", { p_events: events });
      return json({ received: true });
    } catch {
      return json({ error: "Durable acknowledgement unavailable." }, 503);
    }
  }
  if (origin && !origins.has(origin)) {
    return json({ error: "Origin unavailable." }, 403);
  }
  const bearer = req.headers.get("authorization") || "";
  if (!bearer.startsWith("Bearer ")) {
    return json({ error: "Sign in to Marketing." }, 401);
  }
  const caller = createClient(STAGING_SUPABASE, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const identity = await caller.auth.getUser();
  if (identity.error || !identity.data.user) {
    return json({ error: "Sign in to Marketing." }, 401);
  }
  const configured = env("MARKETING_AI_ENABLED") === "true" &&
    Boolean(env("OPENAI_API_KEY") && env("MARKETING_AI_MODEL"));
  if (path === "/configuration" && req.method === "GET") {
    return json({
      ai_configured: configured,
      webhook_configured: Boolean(env("MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN")),
      sending_enabled: false,
    });
  }
  if (path !== "/suggest" || req.method !== "POST") {
    return json({ error: "Endpoint unavailable." }, 404);
  }
  if (!configured) {
    return json({ error: "Marketing AI provider is unavailable." }, 503);
  }
  const raw = await req.text();
  if (raw.length > 4000) return json({ error: "Request too large." }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  let claim: any;
  try {
    const prepared = await rpc(caller, "marketing_inbox_ai_prepare", {
      p_request: body.requestId,
      p_conversation: body.conversationId,
      p_version: body.version,
      p_kind: body.kind,
    });
    if (prepared.state !== "prepared") return json(prepared);
    // Canonical actor derived by the authenticated RPC, not caller-controlled employee identifiers.
    const { data: actor, error } = await caller.rpc("marketing_inbox_actor");
    if (error || !actor) throw new Error("inbox_authority_rejected");
    claim = await rpc(service, "marketing_inbox_ai_claim", {
      p_request: body.requestId,
      p_actor: actor,
    });
    if (!claim) return json({ state: "already_claimed_or_superseded" });
    const result = await requestInboxAI(
      claim,
      env("OPENAI_API_KEY"),
      env("MARKETING_AI_MODEL"),
    );
    return json(
      await rpc(service, "marketing_inbox_ai_finish", {
        p_request: body.requestId,
        p_lease: claim.lease,
        p_body: result.body,
        p_model: result.model,
        p_input: result.input,
        p_output: result.output,
      }),
    );
  } catch {
    if (claim) {
      try {
        await rpc(service, "marketing_inbox_ai_finish", {
          p_request: body.requestId,
          p_lease: claim.lease,
          p_body: {},
          p_model: "",
          p_input: null,
          p_output: null,
          p_error: true,
        });
      } catch {}
    }
    return json({
      error: claim
        ? "AI suggestion could not be verified. No message was sent."
        : "Inbox permission, consent or approved evidence is unavailable.",
    }, claim ? 502 : 409);
  }
});
