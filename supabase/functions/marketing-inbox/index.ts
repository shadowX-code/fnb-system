import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { STAGING_ORIGIN, STAGING_SUPABASE, connectionBinding, unseal } from "../_shared/metaSecurity.ts";
import { MetaGraph, MetaError } from "../_shared/metaGraph.ts";
import { verifyInboxConnection } from "../_shared/metaInboxVerification.ts";
import { advanceInboxDelivery, inboxConnectorContracts } from "../_shared/metaInboxAdapters.ts";
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
      await rpc(service, "marketing_inbox_signed_events", { p_events: events });
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
      staff_send_configured: env('MARKETING_INBOX_SEND_ENABLED')==='true' && Boolean(env('MARKETING_INBOX_TEST_PEER_IDS')),
      webhook_url: `${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`,
      connectors: inboxConnectorContracts,
    });
  }
  if (path==='/verify-connection' && req.method==='POST') {
    try {
      const raw=await req.text();if(raw.length>1000)return json({error:'Request too large.'},413);
      const body=JSON.parse(raw);
      const material=await rpc(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:identity.data.user.id});
      if(!['622626120924115','17841473217923034'].includes(material.provider_account_id))return json({error:'Idamans Staging test scope only.'},403);
      const credential=await unseal(material.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
      const guard=async()=>{const current=await rpc(service,'marketing_meta_diagnostic_material',{p_connection:material.id,p_auth_user:identity.data.user.id});if(current.credential_generation!==material.credential_generation)throw new Error('connection_changed');};
      const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
      const inbound=await rpc(service,'marketing_inbox_verification_events',{p_connection:material.id,p_auth_user:identity.data.user.id});
      const evidence=await verifyInboxConnection(graph,env('MARKETING_META_APP_ID'),`${env('MARKETING_META_APP_ID')}|${env('MARKETING_META_APP_SECRET')}`,material,credential,guard,inbound);
      await guard();
      const channel=await rpc(service,'marketing_inbox_record_verification',{p_connection:material.id,p_auth_user:identity.data.user.id,p_generation:material.credential_generation,p_evidence:evidence});
      // No personal subjects, tokens, raw Graph payloads or message text in diagnostics.
      const {verified_inbound_ids,...safe}=evidence;
      return json({...safe,verified_inbound_count:verified_inbound_ids.length,capability:channel,sending_enabled:false});
    }catch{return json({error:'Messaging verification unavailable. Check scope and connection.'},409);}
  }
  if (path==='/send-approved' && req.method==='POST') {
    if(env('MARKETING_INBOX_SEND_ENABLED')!=='true'||!env('MARKETING_INBOX_TEST_PEER_IDS'))return json({error:'Staff sending is disabled pending explicit test approval.'},403);
    let draftId:string|undefined,lease:string|undefined,ownsLease=false;
    try {
      const raw=await req.text();if(raw.length>1000)return json({error:'Request too large.'},413);
      const body=JSON.parse(raw);draftId=body.draftId;
      await rpc(caller,'marketing_inbox_prepare_send',{p_request:body.requestId,p_draft:draftId});
      let material=await rpc(service,'marketing_inbox_send_material',{p_draft:draftId,p_auth_user:identity.data.user.id});
      const conn=material.connection;
      const allowed=env('MARKETING_INBOX_TEST_PEER_IDS').split(',').map(s=>s.trim());
      if(!['622626120924115','17841473217923034'].includes(conn.provider_account_id)||!allowed.includes(material.recipient))return json({error:'This recipient is outside the approved test scope.'},403);
      const credential=await unseal(conn.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(conn));
      const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
      const guard=async()=>{const current=await rpc(service,'marketing_inbox_send_material',{p_draft:draftId,p_auth_user:identity.data.user.id});if(current.connection.credential_generation!==conn.credential_generation)throw new Error('connection_changed');};
      // Revalidate the independent operation immediately before attempting a write.
      if(material.state==='prepared'){
        const fresh=await verifyInboxConnection(graph,env('MARKETING_META_APP_ID'),`${env('MARKETING_META_APP_ID')}|${env('MARKETING_META_APP_SECRET')}`,conn,credential,guard);
        if(!fresh.authorization_verified||!fresh.subscriptions_verified)throw new Error('messaging_authority_changed');
      }
      lease=material.lease;
      const checkpoint=async(state:any)=>{const result=await rpc(service,'marketing_inbox_send_checkpoint',{p_draft:draftId,p_auth_user:identity.data.user.id,p_lease:lease||null,p_state:state});lease=result.lease;if(state.pending)ownsLease=true;};
      const result=await advanceInboxDelivery({channel:conn.channel,authority:material.authority,recipient:material.recipient,text:material.text,state:material.receipt?{receipt:material.receipt}:material.state==='failed'?{failed:'provider_rejected'}:['pending','reconciling'].includes(material.state)?{pending:true}:{},guard,checkpoint,post:async(path,params)=>{
        try{return await graph.request(path,credential.token,params,'POST');}catch(error){if(error instanceof MetaError&&!error.uncertain)throw Object.assign(new Error('provider_rejected'),{definitive:true});throw error;}
      }});
      if(result.state==='reconciling'&&lease&&ownsLease)await checkpoint({});
      return json(result);
    }catch{
      if(draftId&&lease&&ownsLease)try{await rpc(service,'marketing_inbox_send_checkpoint',{p_draft:draftId,p_auth_user:identity.data.user.id,p_lease:lease,p_state:{}});}catch{}
      return json({error:'Reply execution unavailable; check its delivery evidence before retrying.'},409);
    }
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
  let aiStage = "prepare";
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
    aiStage = "provider";
    const result = await requestInboxAI(
      claim,
      env("OPENAI_API_KEY"),
      env("MARKETING_AI_MODEL"),
    );
    aiStage = "record";
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
  } catch (error) {
    const code = error instanceof Error && ["ai_provider_failed","ai_provider_incomplete","ai_evidence_invalid","ai_citations_missing","ai_shape_invalid","ai_intent_invalid","inbox_authority_rejected"].includes(error.message) ? error.message : "ai_unavailable";
    console.warn("marketing_inbox_ai_failure", {stage: aiStage, code});
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
