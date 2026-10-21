import {describe,it,expect,vi} from 'vitest';
import {normalizeWhatsAppWebhook,whatsappConnectorContract} from '../../../../supabase/functions/_shared/whatsappInbox.ts';
import {verifyInboxSignature,normalizeInboxWebhookEvidence} from '../../../../supabase/functions/_shared/marketingInbox.ts';
import {advanceInboxDelivery} from '../../../../supabase/functions/_shared/metaInboxAdapters.ts';
const now=Date.parse('2026-10-21T12:00:00Z'),timestamp=String(now/1000);
const wire=(value:any,field='messages')=>({object:'whatsapp_business_account',entry:[{id:'100',changes:[{field,value:{messaging_product:'whatsapp',metadata:{phone_number_id:'200'},...value}}]}]});
const msg={id:'wamid.fixture=',from:'60110000000',timestamp,type:'text',text:{body:'Opening hours?'}};
describe('disabled WhatsApp provider fixtures',()=>{
 it('retains exact WABA, phone, peer and provider identity without contact/CRM adoption',()=>{
  const e=normalizeWhatsAppWebhook(wire({messages:[msg],contacts:[{profile:{name:'Untrusted customer'}}]}),now)[0];
  expect(e).toMatchObject({channel:'whatsapp',account_id:'200',waba_id:'100',peer_id:msg.from,event_id:msg.id,kind:'incoming',body:'Opening hours?'});
  expect(JSON.stringify(e)).not.toContain('Untrusted');
  expect(normalizeWhatsAppWebhook(wire({messages:[msg,msg]}),now)).toEqual([e,e]);
 });
 it('retains out-of-order exact statuses independently of message text',()=>{
  const statuses=['read','sent','delivered','failed'].map(status=>({id:msg.id,recipient_id:msg.from,timestamp,status,errors:status==='failed'?[{code:131000,message:'private provider message'}]:undefined}));
  const e=normalizeWhatsAppWebhook(wire({statuses}),now);
  expect(e.map(x=>x.provider_status)).toEqual(['read','sent','delivered','failed']);
  expect(e.every(x=>x.kind==='status'&&x.event_id===msg.id&&x.body==='')).toBe(true);
  expect(JSON.stringify(e)).not.toContain('private provider');
 });
 it('Coexistence echoes are outbound observations, never inbound window evidence',()=>{
  const e=normalizeWhatsAppWebhook(wire({message_echoes:[{...msg,from:'60119999999',to:msg.from}]},'smb_message_echoes'),now)[0];
  expect(e.kind).toBe('echo');expect(e.peer_id).toBe(msg.from);
  expect(normalizeWhatsAppWebhook(wire({messages:[msg]},'history'),now)).toEqual([]);
 });
 it('bounds input and rejects malformed identities, timestamps and shapes',()=>{
  for(const change of [{from:'not-a-peer'},{id:''},{timestamp:String(now/1000+301)},{text:{body:'x'.repeat(8001)}}])expect(()=>normalizeWhatsAppWebhook(wire({messages:[{...msg,...change}]}),now)).toThrow();
  expect(()=>normalizeWhatsAppWebhook(wire({messages:{}}),now)).toThrow();
  expect(()=>normalizeWhatsAppWebhook({object:'whatsapp_business_account',entry:Array(1001).fill({})},now)).toThrow();
 });
 it('does not infer attachments or execute any provider request',()=>{
  const e=normalizeWhatsAppWebhook(wire({messages:[{...msg,type:'image',image:{id:'private-media',caption:'secret'}}]}),now)[0];
  expect(e.kind).toBe('attachment');expect(e.body).toBe('[WhatsApp image]');
  expect(whatsappConnectorContract).toMatchObject({sending_enabled:false,ai_enabled:false,onboarding_enabled:false});
 });
 it('rejects WhatsApp at the shared send adapter even with permissive authority or an uncertain state',async()=>{
  const post=vi.fn(),checkpoint=vi.fn(),guard=vi.fn();
  for(const state of [{},{pending:true},{receipt:'wamid.fixture='}])await expect(advanceInboxDelivery({channel:'whatsapp' as any,authority:{execution_enabled:true},recipient:msg.from,text:'Never send',state,post,checkpoint,guard})).rejects.toThrow('messaging_channel_disabled');
  expect(post).not.toHaveBeenCalled();expect(checkpoint).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();
 });
 it('uses the existing raw-byte signature boundary and preserves social parsing',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(wire({messages:[msg]}))),secret='synthetic-fixture-only';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature='sha256='+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  expect(await verifyInboxSignature(bytes,signature,secret)).toBe(true);
  expect(await verifyInboxSignature(new TextEncoder().encode('changed'),signature,secret)).toBe(false);
  expect(await verifyInboxSignature(bytes,'sha256=00',secret)).toBe(false);
  expect(await normalizeInboxWebhookEvidence({object:'page',entry:[]})).toEqual([]);
 });
});
