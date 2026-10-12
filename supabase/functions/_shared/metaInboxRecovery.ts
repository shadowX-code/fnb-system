import { MetaGraph, MetaError } from './metaGraph.ts';
// Official Conversations API; one page, five conversations, twenty messages each.
// No provider next URLs, outbound messages, attachments or older-brand history are adopted.
export async function readRecentInbox(graph:MetaGraph,connection:any,token:string,pageId:string,guard:()=>Promise<void>,now=Date.now(),verifiedResponse?:any) {
 await guard();
 try {
  const value=verifiedResponse??await graph.request(`${pageId}/conversations`,token,{fields:'id,participants{id},messages.limit(20){id,created_time,from,to,message}',limit:5,...(connection.channel==='instagram'?{platform:'instagram'}:{})});
  if(!Array.isArray(value?.data)||value.data.length>5)throw new MetaError('reconciliation_invalid_response');
  const events:any[]=[];let omitted=false,more=Boolean(value.paging?.next);
  const lower=Math.max(now-86400000,Date.parse(connection.connected_at));
  if(!Number.isFinite(lower))throw new MetaError('reconciliation_identity_unverified');
  for(const row of value.data){
   const participants=row.participants?.data;
   const messages=row.messages?.data;
   if(!Array.isArray(participants)||!Array.isArray(messages)||messages.length>20){omitted=true;continue;}
   more=more||Boolean(row.messages?.paging?.next);
   for(const message of messages){
    const sender=message.from?.id,recipients=message.to?.data,time=Date.parse(message.created_time);
    if(sender===connection.provider_account_id||sender===pageId)continue;
    if(!/^\d{1,32}$/.test(sender||'')||!participants.some((p:any)=>p.id===sender)||!Array.isArray(recipients)||!recipients.some((r:any)=>r.id===connection.provider_account_id)||!Number.isFinite(time)||time<lower||time>now||typeof message.id!=='string'||!message.id||message.id.length>300||typeof message.message!=='string'||!message.message||message.message.length>8000){omitted=true;continue;}
    events.push({channel:connection.channel,account_id:connection.provider_account_id,peer_id:sender,kind:'incoming',event_id:message.id,occurred_at:new Date(time).toISOString(),body:message.message,medium:'dm'});
   }
  }
  await guard();
  return {events,state:'available',reason:more||omitted?'bounded_history_gap':'recent_window_checked',complete:false,more_available:more,omitted,lookback_hours:24,conversation_limit:5,message_limit:20};
 }catch(error){
  if(error instanceof MetaError&&error.code==='connection_health_authority_changed')throw error;
  return {events:[],state:'unavailable',reason:error instanceof MetaError?error.code:'recent_messages_unavailable',complete:false,lookback_hours:24,conversation_limit:5,message_limit:20};
 }
}
