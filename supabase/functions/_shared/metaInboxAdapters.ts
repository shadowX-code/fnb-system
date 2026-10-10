/** Server-only adapters. The staff-only route requires approved, allowlisted durable intent.
 * Fixed official endpoints; every write requires fresh operation-specific authority and durable intent.
 */
import {messagingIntent} from './marketingInbox.ts';
export type InboxDeliveryState={pending?:boolean;receipt?:string;failed?:string};
export async function advanceInboxDelivery(input:{channel:'facebook'|'instagram';authority:any;recipient:string;text:string;state:InboxDeliveryState;guard:()=>Promise<void>;checkpoint:(state:InboxDeliveryState)=>Promise<void>;post:(path:string,body:any)=>Promise<any>}) {
 const {state}=input;
 if(state.receipt)return {state:'sent',receipt:state.receipt};
 if(state.failed)return {state:'failed',code:state.failed};
 if(state.pending)return {state:'reconciling',code:'delivery_receipt_unknown'};
 const intent=messagingIntent(input.channel,input.authority,input.recipient,input.text);
 await input.guard();
 await input.checkpoint({pending:true});
 await input.guard();
 let result:any;
 try { result=await input.post(intent.path,intent.body); }
 catch(error:any) {
  // A transport timeout/lost response may already have delivered: never retry the write.
  if(error?.definitive===true) {await input.checkpoint({failed:'provider_rejected'});return {state:'failed',code:'provider_rejected'};}
  return {state:'reconciling',code:'delivery_receipt_unknown'};
 }
 if(typeof result?.message_id!=='string'||!result.message_id||result.message_id.length>300||result.recipient_id!==input.recipient)return {state:'reconciling',code:'delivery_receipt_unverified'};
 await input.checkpoint({receipt:result.message_id});
 return {state:'sent',receipt:result.message_id};
}
/** Public comment reply contract only; private replies and messaging-window extensions are unsupported. */
export function commentReplyIntent(channel:'facebook'|'instagram',authority:any,commentId:string,text:string) {
 const permission=channel==='facebook'?'pages_manage_engagement':'instagram_manage_comments';
 if(!authority.execution_enabled||!authority.comment_reply_verified||!authority.exact_authorizer_verified||!authority.resource_owned||authority.opted_out||!authority.granted_scopes?.includes(permission)||!/^\d+(?:_\d+)?$/.test(commentId)||!text.trim()||text.length>2000)throw new Error('comment_authority_unverified');
 return {path:`${commentId}/${channel==='facebook'?'comments':'replies'}`,body:{message:text}};
}
export const inboxConnectorContracts={
 facebook:{requiredPermissions:['pages_messaging','pages_manage_metadata'],task:'MESSAGE',subscriptionFields:['messages','messaging_postbacks','message_deliveries','message_reads'],standardWindowHours:24},
 instagram:{requiredPermissions:['instagram_basic','instagram_manage_messages','pages_manage_metadata'],task:'MESSAGE',subscriptionFields:['messages','messaging_postbacks','messaging_seen'],standardWindowHours:24},
 facebook_comments:{receivePermission:'pages_read_user_content',replyPermission:'pages_manage_engagement',subscriptionField:'feed'},
 instagram_comments:{receivePermission:'instagram_manage_comments',replyPermission:'instagram_manage_comments',subscriptionField:'comments'},
};
