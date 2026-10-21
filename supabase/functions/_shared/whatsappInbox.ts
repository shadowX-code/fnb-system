/** WhatsApp wire contracts only. No credentials, customer linking, model calls or sends. */
export type WhatsAppInboxEvent = {
 channel: 'whatsapp'; account_id: string; waba_id: string; peer_id: string;
 kind: 'incoming' | 'attachment' | 'echo' | 'status'; event_id: string;
 occurred_at: string; body: string; medium: 'dm';
 provider_status?: 'sent' | 'delivered' | 'read' | 'failed'; error_code?: string;
};
const numeric = (v: unknown): v is string => typeof v === 'string' && /^\d{1,32}$/.test(v);
const messageId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._=+\/-]{1,300}$/.test(v);
function timestamp(v: unknown, now: number) {
 if (typeof v !== 'string' || !/^\d{1,12}$/.test(v)) throw new Error('invalid_whatsapp_timestamp');
 const ms = Number(v) * 1000;
 if (!Number.isSafeInteger(ms) || ms <= 0 || ms > now + 300000) throw new Error('invalid_whatsapp_timestamp');
 return new Date(ms).toISOString();
}
function list(value: unknown): any[] {
 if (value === undefined) return [];
 if (!Array.isArray(value) || value.length > 1000) throw new Error('invalid_whatsapp_batch');
 return value;
}
export function normalizeWhatsAppWebhook(payload: any, now = Date.now()): WhatsAppInboxEvent[] {
 if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) throw new Error('invalid_whatsapp_webhook');
 const events: WhatsAppInboxEvent[] = [];
 for (const entry of list(payload.entry)) {
  if (!numeric(entry?.id)) throw new Error('invalid_whatsapp_waba');
  for (const change of list(entry.changes)) {
   // History/contact sync is deliberately not live conversation evidence.
   if (!['messages', 'smb_message_echoes'].includes(change?.field)) continue;
   const value = change.value;
   if (value?.messaging_product !== 'whatsapp' || !numeric(value?.metadata?.phone_number_id)) throw new Error('invalid_whatsapp_phone');
   const base = {channel: 'whatsapp' as const, account_id: value.metadata.phone_number_id, waba_id: entry.id, medium: 'dm' as const};
   const echo = change.field === 'smb_message_echoes';
   for (const m of list(echo ? value.message_echoes : value.messages)) {
    const peer = echo ? m?.to : m?.from;
    if (!numeric(peer) || !messageId(m?.id)) throw new Error('invalid_whatsapp_message');
    let body = '';
    if (m.type === 'text') {
     if (typeof m.text?.body !== 'string' || m.text.body.length > 8000) throw new Error('invalid_whatsapp_text');
     body = m.text.body;
    } else if (['image','audio','video','document','sticker','location','contacts','interactive','button','reaction','unsupported'].includes(m.type)) {
     // Do not download assets or treat a remote caption/button as verified CRM data.
     body = `[WhatsApp ${m.type}]`;
    } else throw new Error('unsupported_whatsapp_message');
    events.push({...base, peer_id: peer, kind: echo ? 'echo' : m.type === 'text' ? 'incoming' : 'attachment', event_id: m.id, occurred_at: timestamp(m.timestamp, now), body});
   }
   if (!echo) for (const s of list(value.statuses)) {
    if (!messageId(s?.id) || !numeric(s?.recipient_id) || !['sent','delivered','read','failed'].includes(s?.status)) throw new Error('invalid_whatsapp_status');
    const code = s.errors?.[0]?.code;
    if (code !== undefined && !/^\d{1,12}$/.test(String(code))) throw new Error('invalid_whatsapp_error');
    events.push({...base,peer_id:s.recipient_id,kind:'status',event_id:s.id,occurred_at:timestamp(s.timestamp,now),body:'',provider_status:s.status,...(code === undefined ? {} : {error_code:String(code)})});
   }
   if (events.length > 1000) throw new Error('invalid_whatsapp_batch');
  }
 }
 return events;
}
export const whatsappConnectorContract = Object.freeze({
 channel:'whatsapp', onboarding_enabled:false, sending_enabled:false, ai_enabled:false,
 webhook_fields:['messages','smb_message_echoes'], history_import_enabled:false,
 required_permissions:['whatsapp_business_management','whatsapp_business_messaging'],
});
