import { describe, expect, it, vi } from "vitest";
import {
  aiInput,
  inboxRisks,
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
          sender: { id: "111" },
          recipient: { id: "222" },
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
