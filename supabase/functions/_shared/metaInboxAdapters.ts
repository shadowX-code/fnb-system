/** Server-only adapters. The staff-only route requires approved, allowlisted durable intent.
 * Fixed official endpoints; every write requires fresh operation-specific authority and durable intent.
 */
import {CLOUD_TEST_PHONE} from './whatsappOnboarding.ts';
import {messagingIntent} from './marketingInbox.ts';
export type InboxDeliveryState={pending?:boolean;receipt?:string;failed?:string};
export async function advanceInboxDelivery(input:{channel:'facebook'|'instagram'|'whatsapp';authority:any;whatsappStaff?:boolean;whatsappCampaignCallback?:string;whatsappTemplate?:Record<string,unknown>;recipient:string;text:string;state:InboxDeliveryState;guard:()=>Promise<void>;checkpoint:(state:InboxDeliveryState)=>Promise<void>;post:(path:string,body:any)=>Promise<any>}) {
 if (!['facebook','instagram'].includes(input.channel)&&!(input.channel==='whatsapp'&&(input.whatsappStaff===true||Boolean(input.whatsappCampaignCallback&&input.whatsappTemplate)))) throw new Error('messaging_channel_disabled');
 const {state}=input;
 if(state.receipt)return {state:'sent',receipt:state.receipt};
 if(state.failed)return {state:'failed',code:state.failed};
 if(state.pending)return {state:'reconciling',code:'delivery_receipt_unknown'};
 const whatsapp=input.channel==='whatsapp';
 if(whatsapp&&(!/^\d{7,15}$/.test(input.recipient)||!input.text.trim()||input.text.length>2000))throw new Error('whatsapp_reply_invalid');
 const intent=input.channel==='whatsapp'
  ?{path:`${CLOUD_TEST_PHONE}/messages`,body:{messaging_product:'whatsapp',recipient_type:'individual',to:input.recipient,
    ...(input.whatsappCampaignCallback?{biz_opaque_callback_data:input.whatsappCampaignCallback}:{}),
    ...(input.whatsappTemplate?{type:'template',template:input.whatsappTemplate}:{type:'text',text:{body:input.text,preview_url:false}})}}
  :messagingIntent(input.channel,input.authority,input.recipient,input.text);
 await input.guard();
 await input.checkpoint({pending:true});
 await input.guard();
 let result:any;
 try { result=await input.post(intent.path,intent.body); }
 catch(error:any) {
  // A transport timeout/lost response may already have delivered: never retry the write.
  if(error?.definitive===true) {const code=inboxFailureCode(error);await input.checkpoint({failed:code});return {state:'failed',code};}
  return {state:'reconciling',code:'delivery_receipt_unknown'};
 }
 const receipt=whatsapp?result?.messages?.[0]?.id:result?.message_id;
 const recipient=whatsapp?result?.contacts?.[0]?.wa_id:result?.recipient_id;
 if(typeof receipt!=='string'||!receipt||receipt.length>300||recipient!==input.recipient
  ||(whatsapp&&(!receipt.startsWith('wamid.')||result.messaging_product!=='whatsapp'||result.contacts.length!==1||result.messages.length!==1)))
  return {state:'reconciling',code:'delivery_receipt_unverified'};
 await input.checkpoint({receipt});
 return {state:'sent',receipt};
}
/** Public comment reply contract only; private replies and messaging-window extensions are unsupported. */
export function commentReplyIntent(channel:'facebook'|'instagram',authority:any,commentId:string,text:string) {
 const permission=channel==='facebook'?'pages_manage_engagement':'instagram_manage_comments';
 if(!authority.execution_enabled||!authority.comment_reply_verified||!authority.exact_authorizer_verified||!authority.resource_owned||authority.opted_out||!authority.granted_scopes?.includes(permission)||!/^\d+(?:_\d+)?$/.test(commentId)||!text.trim()||text.length>2000)throw new Error('comment_authority_unverified');
 return {path:`${commentId}/${channel==='facebook'?'comments':'replies'}`,body:{message:text}};
}
export const inboxConnectorContracts={
 facebook:{requiredPermissions:['pages_messaging','pages_manage_metadata'],task:'MESSAGE',subscriptionFields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes'],pageSubscriptionFields:['messages','messaging_postbacks','message_deliveries','message_reads','message_echoes'],standardWindowHours:24},
 instagram:{requiredPermissions:['instagram_basic','instagram_manage_messages','pages_manage_metadata'],task:'MESSAGE',subscriptionFields:['messages','messaging_postbacks','messaging_seen'],pageSubscriptionFields:['messages','messaging_postbacks','message_reads'],standardWindowHours:24},
 facebook_comments:{receivePermission:'pages_read_user_content',replyPermission:'pages_manage_engagement',subscriptionField:'feed'},
 instagram_comments:{receivePermission:'instagram_manage_comments',replyPermission:'instagram_manage_comments',subscriptionField:'comments'},
};

/** Fixed recovery categories only: no provider messages, peers, payloads or credentials. */
export function inboxFailureCode(error:{graphCode?:number;code?:string}) {
 if(error.graphCode===190)return 'provider_token_invalid';
 if([10,200].includes(error.graphCode||0))return 'provider_permission_required';
 if([4,17,32,613].includes(error.graphCode||0))return 'provider_rate_limited';
 if(error.graphCode===551)return 'provider_recipient_unavailable';
 return 'provider_rejected';
}
