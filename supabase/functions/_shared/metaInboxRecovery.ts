import { MetaGraph, MetaError } from './metaGraph.ts';
// Official Conversations API; one page, five conversations, twenty messages each.
// No provider next URLs, attachment URLs or older-brand history are adopted.
export async function readRecentInbox(graph:MetaGraph,connection:any,token:string,pageId:string,guard:()=>Promise<void>,now=Date.now(),verifiedResponse?:any) {
 await guard();
 try {
  const value=verifiedResponse??await graph.request(`${pageId}/conversations`,token,{fields:'id,participants{id},messages.limit(20){id,created_time,from,to,message}',limit:5,...(connection.channel==='instagram'?{platform:'instagram'}:{})});
  if(!Array.isArray(value?.data)||value.data.length>5)throw new MetaError('reconciliation_invalid_response');
  const observations={messages:0,outgoing:0,accepted_outgoing:0,unavailable_content:0,outside_window:0,identity_unverified:0};
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
    const outgoing=sender===connection.provider_account_id||sender===pageId;
    observations.messages++;if(outgoing)observations.outgoing++;
    if(!Number.isFinite(time)||time<lower||time>now){observations.outside_window++;continue;}
    if(typeof message.message!=='string'||!message.message){observations.unavailable_content++;omitted=true;continue;}
    const targets=Array.isArray(recipients)?recipients.filter((r:any)=>r.id!==connection.provider_account_id&&r.id!==pageId):[];
    const peer=outgoing&&targets.length===1?targets[0].id:sender;
    if(!/^\d{1,32}$/.test(peer||'')||peer===connection.provider_account_id||peer===pageId||!participants.some((p:any)=>p.id===peer)||!Array.isArray(recipients)||(!outgoing&&!recipients.some((r:any)=>r.id===connection.provider_account_id))||(outgoing&&targets.length!==1)||!Number.isFinite(time)||time<lower||time>now||typeof message.id!=='string'||!message.id||message.id.length>300||typeof message.message!=='string'||!message.message||message.message.length>8000){observations.identity_unverified++;omitted=true;continue;}
    if(outgoing)observations.accepted_outgoing++;
    events.push({channel:connection.channel,account_id:connection.provider_account_id,peer_id:peer,kind:outgoing?'echo':'incoming',event_id:message.id,occurred_at:new Date(time).toISOString(),body:message.message,medium:'dm'});
   }
  }
  await guard();
  return {events:events.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||a.event_id.localeCompare(b.event_id)),state:'available',reason:more||omitted?'bounded_history_gap':'recent_window_checked',complete:false,more_available:more,omitted,observations,lookback_hours:24,conversation_limit:5,message_limit:20};
 }catch(error){
  if(error instanceof MetaError&&error.code==='connection_health_authority_changed')throw error;
  return {events:[],state:'unavailable',reason:error instanceof MetaError?error.code:'recent_messages_unavailable',complete:false,lookback_hours:24,conversation_limit:5,message_limit:20};
 }
}
