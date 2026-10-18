import {deliverInboxReply} from '../_shared/inboxDelivery.ts';
import {aiAutoReplyConfigured} from '../_shared/marketingExecution.mjs';
import {requestKnowledgeAI} from '../_shared/brandKnowledgeAI.ts';
import {requestInboxAssistant} from '../_shared/inboxAssistant.ts';
import {staffReplyConfigured, staffReplyAllowed} from '../_shared/marketingExecution.mjs';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { STAGING_ORIGIN, STAGING_SUPABASE, connectionBinding, unseal } from "../_shared/metaSecurity.ts";
import {enrichInboxProfile} from "../_shared/metaInboxProfile.ts";
import { MetaGraph } from "../_shared/metaGraph.ts";
import { verifyInboxConnection } from "../_shared/metaInboxVerification.ts";
import { inboxConnectorContracts } from "../_shared/metaInboxAdapters.ts";
import {
  normalizeInboxWebhook,
  inboxWebhookRejection,
  verifyInboxSignature,
} from "../_shared/marketingInbox.ts";
const env = (n: string) => Deno.env.get(n) || "";
const origins = new Set([STAGING_ORIGIN, "http://localhost:5173"]);
async function rpc(db: any, name: string, args: any = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const safe:Record<string,string>={
      'Take over this conversation before sending a staff reply.':'Take over this conversation before sending a staff reply.',
      'Use Resume AI after checking current eligibility.':'Use Resume AI after checking current eligibility.',
      'Enable this Brand’s AI consent in FAQ & AI first.':'Enable this Brand’s AI consent in FAQ & AI first.',
      'Daily knowledge AI limit reached (10).':'Daily knowledge AI limit reached (10).',
      'A knowledge AI request is already running. Check again shortly.':'A knowledge AI request is already running. Check again shortly.',
      'This reply requires review and approval.':'This reply needs approval. Save a draft and request review in reply history.',
      'Conversation changed. Review the latest messages.':'Conversation changed. Review the latest messages before sending.',
      'A reply is already in progress or recorded. Check its result.':'A reply is already in progress or recorded. Check its status before retrying.',
      'Suggestion changed or needs approval.':'The suggestion changed or needs approval. Request a fresh suggestion.',
      'Provide a reply of 1–2000 characters.':'Replies must contain 1–2000 characters.',
      'Marketing permission or brand access is unavailable.':'You do not have permission to send for this brand.'
    };
    throw Object.assign(new Error('inbox_authority_rejected'),{safeMessage:safe[error.message]});
  }
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
    let events, payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
      events = normalizeInboxWebhook(payload);
    } catch (error) {
      // Fixed contract codes only, after HMAC verification. Never log payloads/peers/text.
      console.warn(JSON.stringify(inboxWebhookRejection(payload, error)));
      return json({ error: "Invalid webhook contract." }, 400);
    }
    try {
      await rpc(service, "marketing_inbox_receive", { p_events: events });
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
      ai_auto_configured: configured&&aiAutoReplyConfigured(env),
      ai_model: env('MARKETING_AI_MODEL') || null,
      ai_status: env('MARKETING_AI_ENABLED')!=='true'?'disabled':!env('MARKETING_AI_MODEL')?'missing_model':!env('OPENAI_API_KEY')?'missing_provider':'ready',
      webhook_configured: Boolean(env("MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN")),
      sending_enabled: false,
      staff_send_configured: staffReplyConfigured(env),
      webhook_url: `${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`,
      connectors: inboxConnectorContracts,
    });
  }
  if(path==='/knowledge'&&req.method==='POST') {
    if(!configured)return json({error:'AI is unavailable. Save knowledge manually or ask an administrator to check the existing provider.'},409);
    let claim:any,requestId:string|undefined;
    try {
      const raw=await req.text();if(raw.length>6000)return json({error:'Request too large.'},413);
      const body=JSON.parse(raw);requestId=body.requestId;
      const prepared=await rpc(caller,'marketing_knowledge_ai_prepare',{p_request:requestId,p_brand:body.brandId,p_kind:body.kind,p_entry:body.entryId||null,p_preview:body.preview||null});
      if(prepared.state!=='prepared')return json(prepared);
      claim=await rpc(service,'marketing_knowledge_ai_claim',{p_request:requestId,p_auth_user:identity.data.user.id});
      let bytes:Uint8Array|undefined;
      if(claim.kind==='menu') {
        const {data,error}=await service.storage.from('marketing-knowledge').download(claim.entry.object_path);
        if(error||!data||data.size!==claim.entry.size_bytes||data.size>5242880)throw new Error('invalid_menu_file');
        bytes=new Uint8Array(await data.arrayBuffer());
      }
      const value=await requestKnowledgeAI(claim.kind,claim,env('OPENAI_API_KEY'),env('MARKETING_AI_MODEL'),bytes);
      return json(await rpc(service,'marketing_knowledge_ai_finish',{p_request:requestId,p_lease:claim.lease,p_result:value.result,p_usage:value.usage}));
    }catch(error) {
      const reason=error instanceof Error&&['invalid_menu_file','menu_items_invalid','menu_warning_invalid','menu_currency_invalid','menu_text_invalid','menu_price_invalid','ai_shape_invalid','ai_provider_failed','ai_provider_incomplete','ai_rate_limited'].includes(error.message)?error.message:'knowledge_ai_unavailable';
      if(claim)try{await rpc(service,'marketing_knowledge_ai_finish',{p_request:requestId,p_lease:claim.lease,p_result:{},p_usage:(error as any)?.usage||{},p_error:reason});}catch{}
      // No file contents, private URLs or raw provider errors in diagnostics.
      return json({error:(error as {safeMessage?:string})?.safeMessage||(reason==='invalid_menu_file'?'The file does not match its declared format. Choose the original PDF or image.':'Knowledge AI is unavailable or this request is not eligible. Check Brand AI consent, permissions and request status before retrying.')},409);
    }
  }
  if(path==='/profiles'&&req.method==='POST') {
    try {
      const raw=await req.text();if(raw.length>2000)return json({error:'Request too large.'},413);
      const ids=JSON.parse(raw).conversationIds;
      if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))return json({error:'Choose up to twenty conversations.'},400);
      const profiles:Record<string,unknown>={};
      const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
      const pending=[...new Set<string>(ids)];
      await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
        while(pending.length) {
          const id=pending.shift()!;
          try {
            profiles[id]=await enrichInboxProfile(service,graph.withSignal(AbortSignal.timeout(5000)),[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],id,identity.data.user.id);
          }catch{profiles[id]={available:false};}
        }
      }));
      return json({profiles});
    }catch{return json({error:'Customer profiles unavailable.'},409);}
  }
  if (path==='/verify-connection' && req.method==='POST') {
    try {
      const raw=await req.text();if(raw.length>1000)return json({error:'Request too large.'},413);
      const body=JSON.parse(raw);
      const material=await rpc(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:identity.data.user.id});
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
  if(path==='/send-status' && req.method==='POST'){
    try{const raw=await req.text();if(raw.length>1000)return json({error:'Request too large.'},413);const body=JSON.parse(raw);const scope=await rpc(service,'marketing_inbox_staff_send_scope',{p_conversation:body.conversationId,p_auth_user:identity.data.user.id});
      return json({staff_send_configured:staffReplyConfigured(env),recipient_allowed:staffReplyAllowed(scope.account,scope.peer,env)});
    }catch{return json({error:'Sending availability could not be checked.'},403);}
  }
  if (['/send-approved','/send-staff-reply'].includes(path) && req.method==='POST') {
    if(!staffReplyConfigured(env))return json({error:'Staff sending is disabled pending explicit test approval.'},403);
    let draftId:string|undefined;
    try {
      const raw=await req.text();if(raw.length>12000)return json({error:'Request too large.'},413);
      const body=JSON.parse(raw);draftId=body.draftId;
      if(path==='/send-staff-reply'){
        // Check exact test recipient before recording intent, with the same server-only gate as approved sends.
        const scope=await rpc(service,'marketing_inbox_staff_send_scope',{p_conversation:body.conversationId,p_auth_user:identity.data.user.id});
        if(!staffReplyAllowed(scope.account,scope.peer,env))return json({error:'Recipient is outside the approved test scope.'},403);
        const prepared=await rpc(caller,'marketing_inbox_prepare_staff_reply',{p_request:body.requestId,p_conversation:body.conversationId,p_version:body.version,p_body:body.text,p_artifact:body.sourceArtifactId||null});draftId=prepared.draft_id;
      }else await rpc(caller,'marketing_inbox_prepare_send',{p_request:body.requestId,p_draft:draftId});
      const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
      const result=await deliverInboxReply(service,graph,env,draftId!,identity.data.user.id,(account,peer)=>staffReplyAllowed(account,peer,env));
      return json(result);
    }catch(error){
      return json({error:(error as {safeMessage?:string})?.safeMessage||'Reply unavailable. Check connection status, reply window and any existing send result.'},409);
    }
  }
  if (path !== "/suggest" || req.method !== "POST") {
    return json({ error: "Endpoint unavailable." }, 404);
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
    const result = await requestInboxAssistant(
      claim,
      configured ? env("OPENAI_API_KEY") : "",
      configured ? env("MARKETING_AI_MODEL") : "",
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
