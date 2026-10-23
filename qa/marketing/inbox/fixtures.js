// Deterministic canonical read-model fixtures. Never imported by application code or persisted.
export const conversation = {id:'wa-demo',organization_id:'org',brand_id:'brand-a',version:2,channel:'whatsapp',medium:'dm',status:'open',priority:'normal',tags:[],escalation_reasons:[],takeover:true,customer_profile:{display_name:'Fixture customer'},brand_name:'Fixture Brand A',unread_count:3,latest_message:'Can I see the menu?',latest_message_kind:'incoming',latest_message_at:'2026-10-23T02:30:00Z'};
const message=(id,kind,body,extra={})=>({id,kind,body,sequence:id,occurred_at:`2026-10-23T02:${String(id).padStart(2,'0')}:00Z`,evidence_source:'signed_webhook',...extra});
export const messages = [
 message(1,'incoming','Historical question',{evidence_source:'historical_import'}),
 message(2,'echo','Historical answer',{evidence_source:'historical_import',message_origin:'meta'}),
 ...['image','video','document','audio','sticker','unsupported'].map((type,i)=>message(i+3,'attachment',`[WhatsApp ${type}]`)),
 message(9,'incoming','Can I see the menu?'),
 message(10,'echo','I will help you from the mobile app.',{message_origin:'meta',sender_type:'external_unknown'}),
 ...['sent','delivered','read','failed','reconciling'].map((state,i)=>message(i+11,'echo',`Receipt example: ${state}`,{sender_type:'feedx_staff',message_origin:'feedx',send_state:state,provider_message_id:`fixture-${state}`})),
 message(16,'incoming','A long message with a very long address: '+ 'long-text-'.repeat(120)),
];
export const olderMessages = Array.from({length:30},(_,i)=>({...message(i+1,'incoming',`Older message ${i+1}`),id:`older-${i}`,occurred_at:`2026-10-22T02:${String(i).padStart(2,'0')}:00Z`}));
export function detail(page=1) {return {conversation,messages:page===1?messages:olderMessages,total:46,timeline_projected:true,read_through_sequence:46,drafts:[],artifacts:[],outbox:[],members:[],audit_messages:[],policy:{ai_allowed:true,ai_reply_mode:'ai_first'},ai_handling:{mode:'ai_first'},channel_capability:{receiving_verified:false},window_open:false,reply_requires_approval:false};}
export const context={organizations:[{id:'org',name:'Fixture workspace'}],brands:[{id:'brand-a',organization_id:'org',name:'Fixture Brand A'},{id:'brand-b',organization_id:'org',name:'Fixture Brand B'}]};
export function read({brand,channel,search='',page=1,unread=false}={}) {
 const rows=brand==='brand-b'||!['social','whatsapp','',undefined].includes(channel)||!conversation.latest_message.toLowerCase().includes(search.toLowerCase())||page!==1?[]:[conversation];
 return {rows,total:rows.length,members:[],channels:[],faqs:[],policy:{revision:0},knowledge:null};
}
