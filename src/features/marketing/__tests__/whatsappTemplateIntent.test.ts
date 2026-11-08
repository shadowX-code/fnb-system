import {expect,it,vi} from 'vitest';
import {whatsappTemplateIntent} from '../../../../supabase/functions/_shared/whatsappTemplateIntent.ts';
import {advanceInboxDelivery} from '../../../../supabase/functions/_shared/metaInboxAdapters.ts';
import {applyWhatsAppSimulation} from '../../../../supabase/functions/_shared/inboxPlayground.ts';

const phone='1221509657713215';
const template={id:'321',name:'booking',language:'en_US',status:'APPROVED',category:'UTILITY',parameter_format:'NAMED',
 components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Booking for {{name}}'},
  {type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Confirm'},{type:'URL',text:'View',url:'https://example.com/booking/{{1}}'}]}]};
const choice={id:'321',language:'en_US',mediaId:'456',values:{'body:name':'Ari','button:0':'confirm','button:1':'booking-001'}};
const graph=(row=template,mime='image/png')=>({request:vi.fn(async(path:string)=>path==='456'
 ?{id:'456',messaging_product:'whatsapp',mime_type:mime}
 :{data:[row]})});
it('validates exact approved locale, media ownership and all text/button parameters',async()=>{
 const g=graph();
 const result=await whatsappTemplateIntent(g,'fixture',choice,phone);
 expect(g.request.mock.calls[0][0]).toBe('1675083730240518/message_templates');
 expect(result.text).toBe('Booking for Ari\nConfirm\nView');
 expect(result.template.components).toEqual([
  {type:'header',parameters:[{type:'image',image:{id:'456'}}]},
  {type:'body',parameters:[{type:'text',text:'Ari',parameter_name:'name'}]},
  {type:'button',sub_type:'quick_reply',index:'0',parameters:[{type:'payload',payload:'confirm'}]},
  {type:'button',sub_type:'url',index:'1',parameters:[{type:'text',text:'booking-001'}]},
 ]);
 await expect(whatsappTemplateIntent(graph(),'fixture',{...choice,language:'ms'},phone)).rejects.toThrow('template_not_in_verified_waba');
 await expect(whatsappTemplateIntent(graph({...template,status:'PAUSED'}),'fixture',choice,phone)).rejects.toThrow('template_not_approved_utility');
 await expect(whatsappTemplateIntent(graph(template,'text/plain'),'fixture',choice,phone)).rejects.toThrow('template_media_type_invalid');
 await expect(whatsappTemplateIntent(graph(),'fixture',{...choice,values:{...choice.values,'button:1':'../unexpected/path'}},phone)).rejects.toThrow('template_button_value_invalid');
});
it('uses the shared pending checkpoint and never repeats an uncertain template POST',async()=>{
 const intent=await whatsappTemplateIntent(graph(),'fixture',choice,phone);
 const post=vi.fn().mockRejectedValue(new Error('timeout'));
 let state={};
 const input={channel:'whatsapp' as const,whatsappStaff:true,whatsappTemplate:intent.template,authority:{},
  recipient:'60123456789',text:intent.text,guard:async()=>{},checkpoint:async(next:Record<string,unknown>)=>{state=next},post};
 expect((await advanceInboxDelivery({...input,state})).state).toBe('reconciling');
 expect((await advanceInboxDelivery({...input,state})).state).toBe('reconciling');
 expect(post).toHaveBeenCalledExactlyOnceWith(`${phone}/messages`,expect.objectContaining({type:'template',template:intent.template}));
});
it.each(['suggest_only','safe_auto_reply','ai_first'])('projects WhatsApp safeguards for %s without touching dispatch',mode=>{
 const decision={kind:'reply',text:'Example'};
 const completed={state:'completed',result:{mode,decision}};
 expect(applyWhatsAppSimulation(completed,'eligible').result.decision).toEqual(decision);
 const closed=applyWhatsAppSimulation(completed,'service_window_closed').result.decision;
 expect(closed.kind).toBe(mode==='suggest_only'?'reply':'handoff');
 for(const scenario of ['consent_missing','human_takeover','external_owner','credential_unverified'])
  expect(applyWhatsAppSimulation(completed,scenario).result.decision.kind).toBe(mode==='suggest_only'?'reply':'handoff');
});

it('checkpoints exact Meta acceptance and reuses the provider receipt on repeat',async()=>{
 const intent=await whatsappTemplateIntent(graph(),'fixture',choice,phone);
 const post=vi.fn().mockResolvedValue({messaging_product:'whatsapp',contacts:[{wa_id:'60123456789'}],messages:[{id:'wamid.template_fixture'}]});
 let state={};
 const input={channel:'whatsapp' as const,whatsappStaff:true,whatsappTemplate:intent.template,authority:{},
  recipient:'60123456789',text:intent.text,guard:async()=>{},checkpoint:async(next:Record<string,unknown>)=>{state=next},post};
 await expect(advanceInboxDelivery({...input,state})).resolves.toEqual({state:'sent',receipt:'wamid.template_fixture'});
 await expect(advanceInboxDelivery({...input,state})).resolves.toEqual({state:'sent',receipt:'wamid.template_fixture'});
 expect(post).toHaveBeenCalledTimes(1);
});
