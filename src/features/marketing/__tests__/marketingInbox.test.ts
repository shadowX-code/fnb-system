import { describe, expect, it, vi } from "vitest";
import {
  aiInput,
  inboxRisks,
  inboxWebhookRejection,
  messagingIntent,
  normalizeInboxWebhook,
  requestInboxAI,
  standardWindowOpen,
  validateAISuggestion,
  verifyInboxSignature,
} from "../../../../supabase/functions/_shared/marketingInbox.ts";
const now = Date.now(),
  incoming = {
    sender: { id: "222" },
    recipient: { id: "111" },
    timestamp: now,
    message: { mid: "mid1", text: "Hello" },
  };
describe("Inbox integration contracts", () => {
  it("pins the latest customer question independently of earlier history and staff notes", () => {
    const input = aiInput({kind:"reply",facts:{identity:"Approved brand"},history:[{kind:"incoming",text:"Brand name?"},{kind:"incoming",text:"Meal price?"},{kind:"note",text:"Staff note"}]});
    expect(input.latest_customer_message).toBe("Meal price?");
    expect(input.internal_test_question).toBe("");
    expect(aiInput({kind:"reply",facts:{},history:[{kind:"note",text:"Brand name?"},{kind:"note",text:"Meal price?"}]}).internal_test_question).toBe("Meal price?");
  });
  it("normalizes inbound and echo direction without profile or attachment URLs", () => {
    const rows = normalizeInboxWebhook({
      object: "page",
      entry: [{
        id: "111",
        messaging: [incoming, {
          ...incoming,
          sender: { id: "111" },
          recipient: { id: "222" },
          message: {
            mid: "echo",
            is_echo: true,
            attachments: [{
              type: "image",
              payload: { url: "https://secret.invalid/token" },
            }],
          },
        }],
      }],
    }, now);
    expect(rows.map((x) => [x.kind, x.peer_id, x.account_id])).toEqual([[
      "incoming",
      "222",
      "111",
    ], ["echo", "222", "111"]]);
    expect(JSON.stringify(rows)).not.toContain("secret.invalid");
  });
  it("rejects identity mismatch, oversized batches and future events", () => {
    for (
      const event of [{ ...incoming, recipient: { id: "333" } }, {
        ...incoming,
        timestamp: now + 300001,
      }]
    ) {
      expect(() =>
        normalizeInboxWebhook({
          object: "page",
          entry: [{ id: "111", messaging: [event] }],
        }, now)
      ).toThrow();
    }
    expect(() =>
      normalizeInboxWebhook({ object: "page", entry: Array(1001).fill({}) })
    ).toThrow();
  });
  it("normalizes IG receipts and delivery mids without opening an inbound window", () => {
    const rows = normalizeInboxWebhook({
      object: "instagram",
      entry: [{
        id: "111",
        messaging: [{
          sender: { id: "222" },
          recipient: { id: "111" },
          timestamp: now,
          seen: { watermark: now },
        }],
      }],
    }, now);
    expect(rows[0].kind).toBe("read");
    expect(standardWindowOpen(null, now)).toBe(false);
    expect(standardWindowOpen(new Date(now - 86400000).toISOString(), now))
      .toBe(false);
    expect(standardWindowOpen(new Date(now + 1).toISOString(), now)).toBe(
      false,
    );
    expect(standardWindowOpen(new Date(now - 1).toISOString(), now)).toBe(true);
  });
  it("accepts the official customer-to-Page delivery receipt without an event timestamp", () => {
    const rows=normalizeInboxWebhook({object:"page",entry:[{id:"111",messaging:[{sender:{id:"222"},recipient:{id:"111"},delivery:{mids:["sent-mid"],watermark:now}}]}]},now);
    expect(rows[0]).toMatchObject({kind:"delivery",peer_id:"222",account_id:"111",event_id:"sent-mid",occurred_at:new Date(now).toISOString()});
    expect(()=>normalizeInboxWebhook({object:"page",entry:[{id:"111",messaging:[{sender:{id:"111"},recipient:{id:"222"},delivery:{mids:["sent-mid"],watermark:now}}]}]},now)).toThrow("account_identity_mismatch");
  });
  it("retains Instagram's exact seen message ID rather than a read watermark", () => {
    const event={sender:{id:"222"},recipient:{id:"111"},timestamp:now,read:{mid:"only-this-message"}};
    const payload={object:"instagram",entry:[{id:"111",messaging:[event]}]};
    expect(normalizeInboxWebhook(payload,now)[0]).toMatchObject({kind:"read",event_id:"only-this-message",occurred_at:new Date(now).toISOString()});
    expect(()=>normalizeInboxWebhook({...payload,entry:[{id:"111",messaging:[{...event,read:{mid:""}}]}]},now)).toThrow("invalid_receipt");
    expect(normalizeInboxWebhook({object:"page",entry:[{id:"111",messaging:[{...event,read:{watermark:now}}]}]},now)[0].event_id).toBe(`222:${now}`);
  });
  it("sanitizes rejection diagnostics including arbitrary errors and payloads", () => {
    expect(inboxWebhookRejection({object:"instagram",token:"secret",entry:[incoming]},new Error("account_identity_mismatch"))).toEqual({event:"marketing_inbox_webhook_rejected",object:"instagram",reason:"account_identity_mismatch"});
    expect(inboxWebhookRejection({object:"secret"},new Error("personal message secret"))).toEqual({event:"marketing_inbox_webhook_rejected",object:"unknown",reason:"invalid_contract"});
  });
  it("verifies the signature against exact raw bytes", async () => {
    const raw = new TextEncoder().encode('{"test":1}'),
      key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("test-secret"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw)),
      signature = "sha256=" +
        Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyInboxSignature(raw, signature, "test-secret")).toBe(
      true,
    );
    expect(
      await verifyInboxSignature(
        new TextEncoder().encode('{"test":2}'),
        signature,
        "test-secret",
      ),
    ).toBe(false);
    expect(await verifyInboxSignature(raw, signature, "")).toBe(false);
  });
  it("escalates sensitive cases in EN, ZH and BM", () => {
    expect(
      inboxRisks("Refund for food poisoning, allergic reaction, complaint"),
    ).toEqual(["complaint", "refund", "allergen", "food_safety"]);
    expect(inboxRisks("退款 过敏 食物中毒 投诉")).toHaveLength(4);
    expect(inboxRisks("aduan bayaran balik alahan keracunan")).toHaveLength(4);
  });
  it("rejects invented evidence and forces sensitive suggestions to human handling", () => {
    const suggestion = {
      text: "We open at 10.",
      question: "When are you open?",
      language: "EN",
      reference_keys: ["rules"],
      human_required: false,
    };
    expect(validateAISuggestion(suggestion, { rules: {} }, "reply")).toEqual(
      suggestion,
    );
    expect(() => validateAISuggestion(suggestion, {}, "reply")).toThrow();
    expect(() =>
      validateAISuggestion({ ...suggestion, reference_keys: [] }, {}, "reply")
    ).toThrow();
    expect(
      validateAISuggestion({ ...suggestion, text: "Ask about allergens" }, {
        rules: {},
      }, "reply").human_required,
    ).toBe(true);
  });
  it("removes contact details and does not claim output without a completed provider result", async () => {
    expect(
      aiInput({
        kind: "reply",
        facts: {},
        history: [{ kind: "incoming", text: "me@example.com +60123456789" }],
      }).history[0].text,
    ).toBe("[email removed] [number removed]");
    const transport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "incomplete", output: [] })),
    );
    await expect(
      requestInboxAI(
        { facts: {}, history: [], kind: "reply" },
        "fixture-key",
        "fixture-model",
        transport,
      ),
    ).rejects.toThrow("incomplete");
    const body = JSON.parse(transport.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
  });
  it("keeps sending unavailable despite successful read synchronization", () => {
    expect(() =>
      messagingIntent(
        "instagram",
        {
          can_post: true,
          read_verified: true,
          granted_scopes: ["instagram_manage_messages"],
          last_inbound_at: new Date(now - 100).toISOString(),
        },
        "222",
        "Hello",
        now,
      )
    ).toThrow("authority");
  });
});

it("normalizes comments separately without opening a private messaging window",()=>{
 const rows=normalizeInboxWebhook({object:"instagram",entry:[{id:"111",time:Math.floor(now/1000),changes:[{field:"comments",value:{id:"555",from:{id:"222",username:"private-name"},media:{id:"444"},text:"Harga?"}}]}]},now);
 expect(rows[0]).toMatchObject({medium:"comment",thread_id:"444",event_id:"comment:555",peer_id:"222"});
 expect(JSON.stringify(rows)).not.toContain("private-name");
 expect(()=>normalizeInboxWebhook({object:"page",entry:[{id:"111",changes:[{field:"feed",value:{item:"comment",verb:"add",comment_id:"111_555",post_id:"111_444",from:{id:"222"},message:"Hello",created_time:Math.floor(now/1000)}}]}]},now)).not.toThrow();
});

it('accepts signed standby echoes and preserves unavailable outgoing direction',()=>{
 const time=Date.now(); const event={sender:{id:'111'},recipient:{id:'222'},timestamp:time,message:{mid:'external-mid',is_echo:true,text:'Meta page reply'}};
 expect(normalizeInboxWebhook({object:'page',entry:[{id:'111',standby:[event]}]},time)[0]).toMatchObject({kind:'echo',peer_id:'222',body:'Meta page reply'});
 expect(normalizeInboxWebhook({object:'page',entry:[{id:'111',messaging:[{...event,message:{...event.message,is_deleted:true}}]}]},time)[0].kind).toBe('echo');
});

it('retains outbound app evidence without claiming a native automation identity',async()=>{
 const {normalizeInboxWebhookEvidence}=await import('../../../../supabase/functions/_shared/marketingInbox.ts');const t=Date.now();
 const rows=await normalizeInboxWebhookEvidence({object:'page',entry:[{id:'111',messaging:[{sender:{id:'111'},recipient:{id:'222'},timestamp:t,message:{mid:'external-mid',is_echo:true,app_id:123456,text:'An actual sent reply'}}]}]},t);
 expect(rows[0]).toMatchObject({kind:'echo',provider_app_id:'123456',peer_id:'222'});expect(rows[0]).not.toHaveProperty('automation_handled');
});
it('separates displayed prompts from selections and deduplicates exact postback deliveries',async()=>{
 const {normalizeInboxWebhookEvidence}=await import('../../../../supabase/functions/_shared/marketingInbox.ts');const t=Date.now();
 expect(await normalizeInboxWebhookEvidence({object:'page',entry:[{id:'111',messaging:[]}]},t)).toEqual([]);
 const selected={sender:{id:'222'},recipient:{id:'111'},timestamp:t,postback:{title:'Opening hours?',payload:'hours'}};
 const payload={object:'page',entry:[{id:'111',messaging:[selected]}]};const a=await normalizeInboxWebhookEvidence(payload,t),b=await normalizeInboxWebhookEvidence(payload,t);
 expect(a).toEqual(b);expect(a[0]).toMatchObject({kind:'attachment',interaction_type:'postback',interaction_payload:'hours',body:'Opening hours?'});expect(a[0].event_id).toMatch(/^postback:[a-f0-9]{64}$/);
 const c=await normalizeInboxWebhookEvidence({object:'page',entry:[{id:'111',messaging:[{...selected,postback:{...selected.postback,payload:'another'}}]}]},t);expect(c[0].event_id).not.toBe(a[0].event_id);
});
it('keeps quick-reply selections as customer input, never business replies',async()=>{
 const {normalizeInboxWebhookEvidence}=await import('../../../../supabase/functions/_shared/marketingInbox.ts');const t=Date.now();
 const [row]=await normalizeInboxWebhookEvidence({object:'instagram',entry:[{id:'111',messaging:[{sender:{id:'222'},recipient:{id:'111'},timestamp:t,message:{mid:'customer-selection',text:'Menu?',quick_reply:{payload:'menu'}}}]}]},t);
 expect(row).toMatchObject({kind:'incoming',interaction_type:'quick_reply',interaction_payload:'menu'});
});
