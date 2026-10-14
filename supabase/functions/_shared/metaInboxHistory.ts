import {MetaError,MetaGraph} from './metaGraph.ts';
// Fixed GETs only. The checkpoint contains provider IDs/cursors, never message bodies.
const threadId=(v:unknown)=>typeof v==='string'&&/^(?:t_)?\d{1,80}$/.test(v);
function after(value:any,previous?:string){
 if(!value?.paging?.next)return null;
 const cursor=value.paging?.cursors?.after;
 if(typeof cursor!=='string'||!cursor||cursor.length>4096||! /^[A-Za-z0-9_+=/.-]+$/.test(cursor)||cursor===previous)throw new MetaError('history_cursor_unavailable');
 return cursor;
}
export async function readInboxHistoryPage(graph:MetaGraph,connection:any,token:string,pageId:string,job:any,guard:()=>Promise<void>){
 await guard();
 const state=job.checkpoint||{},lower=Date.parse(job.window_from),upper=Date.parse(job.window_to);
 if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower>upper||upper-lower>30*86400000||lower<Date.parse(connection.connected_at))throw new MetaError('history_window_unverified');
 let row:any,conversationAfter=state.conversation_after||null;
 if(state.thread){
  if(!threadId(state.thread)||!state.message_after||! /^[A-Za-z0-9_+=/.-]{1,4096}$/.test(state.message_after))throw new MetaError('history_checkpoint_invalid');
  row=await graph.request(state.thread,token,{fields:`id,participants{id},messages.limit(20).after(${state.message_after}){id,created_time,from,to,message}`});
  if(row.id!==state.thread)throw new MetaError('history_identity_unverified');
 }else{
  const value=await graph.request(`${pageId}/conversations`,token,{fields:'id,participants{id},messages.limit(20){id,created_time,from,to,message}',limit:1,after:state.conversation_after||undefined,...(connection.channel==='instagram'?{platform:'instagram'}:{})});
  if(!Array.isArray(value?.data)||value.data.length>1)throw new MetaError('history_response_invalid');
  conversationAfter=after(value,state.conversation_after);
  row=value.data[0];
  if(!row)return {events:[],checkpoint:{},done:true,omitted:0,scanned:0};
 }
 if(!threadId(row.id)||!Array.isArray(row.participants?.data)||!Array.isArray(row.messages?.data)||row.messages.data.length>20)throw new MetaError('history_response_invalid');
 const events:any[]=[];let omitted=0;
 for(const m of row.messages.data){
  const sender=m.from?.id,recipients=m.to?.data,time=Date.parse(m.created_time);
  if(!Number.isFinite(time)||time<lower||time>upper)continue;
  const outgoing=sender===connection.provider_account_id||sender===pageId;
  const targets=Array.isArray(recipients)?recipients.filter((r:any)=>r.id!==connection.provider_account_id&&r.id!==pageId):[];
  const peer=outgoing&&targets.length===1?targets[0].id:sender;
  if(!/^\d{1,32}$/.test(peer||'')||peer===connection.provider_account_id||peer===pageId||!row.participants.data.some((p:any)=>p.id===peer)||!Array.isArray(recipients)||(!outgoing&&!recipients.some((r:any)=>r.id===connection.provider_account_id))||(outgoing&&targets.length!==1)||typeof m.id!=='string'||!m.id||m.id.length>300||typeof m.message!=='string'||!m.message||m.message.length>8000){omitted++;continue;}
  events.push({channel:connection.channel,account_id:connection.provider_account_id,peer_id:peer,kind:outgoing?'echo':'incoming',event_id:m.id,occurred_at:new Date(time).toISOString(),body:m.message,medium:'dm'});
 }

 const messageAfter=after(row.messages,state.message_after);
 await guard();
 return {events:events.sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)),checkpoint:messageAfter?{thread:row.id,message_after:messageAfter,conversation_after:conversationAfter}:conversationAfter?{conversation_after:conversationAfter}:{},done:!messageAfter&&!conversationAfter,omitted,scanned:row.messages.data.length};
}
export async function runInboxHistory(db:any,graph:MetaGraph,tokenFor:(c:any)=>Promise<string>){
 const call=async(name:string,args:any={})=>{const {data,error}=await db.rpc(name,args);if(error)throw new MetaError('history_authority_changed');return data;};
 const job=await call('marketing_inbox_history_claim');if(!job)return false;
 const args={p_job:job.id,p_lease:job.lease};
 const guard=async()=>{if(!await call('marketing_inbox_history_guard',args))throw new MetaError('history_authority_changed');};
 try{
  await guard();const result=await readInboxHistoryPage(graph,job.connection,await tokenFor(job.connection),job.page_id,job,guard);
  await call('marketing_inbox_history_finish',{...args,p_result:result,p_error:null});
 }catch(error){await call('marketing_inbox_history_finish',{...args,p_result:null,p_error:error instanceof MetaError?error.code:'history_unavailable'});}
 return true;
}
