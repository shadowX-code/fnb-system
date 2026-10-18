import {connectionBinding,unseal} from './metaSecurity.ts';
import {MetaError} from './metaGraph.ts';
import {verifyInboxConnection} from './metaInboxVerification.ts';
import {advanceInboxDelivery} from './metaInboxAdapters.ts';

/** Staff and automatic replies consume the same durable delivery authority and receipt ledger. */
export async function deliverInboxReply(db:any,graph:any,get:(key:string)=>string,draftId:string,authUser:string,allowed:(account:string,peer:string)=>boolean) {
 const call=async(name:string,args:any)=>{const r=await db.rpc(name,args);if(r.error)throw new Error('inbox_delivery_authority_changed');return r.data;};
 let lease:string|undefined,ownsLease=false;
 const args={p_draft:draftId,p_auth_user:authUser};
 const checkpoint=async(state:any)=>{const result=await call('marketing_inbox_send_checkpoint',{...args,p_lease:lease||null,p_state:state});lease=result.lease;if(state.pending)ownsLease=true;};
 try {
  const material=await call('marketing_inbox_send_material',args);
  if(!['prepared','pending','reconciling','sent','delivered','read','failed'].includes(material.state))throw new Error('inbox_delivery_authority_changed');
  const conn=material.connection;
  if(!allowed(conn.provider_account_id,material.recipient))throw new Error('inbox_execution_disabled');
  const credential=await unseal(conn.sealed_token,[get('MARKETING_META_TOKEN_ENCRYPTION_KEY'),get('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(conn));
  const guard=async()=>{const current=await call('marketing_inbox_send_material',args);if(current.connection.credential_generation!==conn.credential_generation||!allowed(current.connection.provider_account_id,current.recipient))throw new Error('inbox_delivery_authority_changed');};
  if(material.state==='prepared') {
   const fresh=await verifyInboxConnection(graph,get('MARKETING_META_APP_ID'),`${get('MARKETING_META_APP_ID')}|${get('MARKETING_META_APP_SECRET')}`,conn,credential,guard);
   if(!fresh.authorization_verified||!fresh.subscriptions_verified)throw new Error('messaging_authority_changed');
  }
  lease=material.lease;
  const result=await advanceInboxDelivery({channel:conn.channel,authority:material.authority,recipient:material.recipient,text:material.text,state:material.receipt?{receipt:material.receipt}:material.state==='failed'?{failed:material.failure_code||'provider_rejected'}:['pending','reconciling'].includes(material.state)?{pending:true}:{},guard,checkpoint,post:async(path,params)=>{
   try{return await graph.request(path,credential.token,params,'POST');}catch(error){if(error instanceof MetaError&&!error.uncertain)throw Object.assign(new Error('provider_rejected'),{definitive:true,graphCode:error.graphCode});throw error;}
  }});
  if(result.state==='reconciling'&&lease&&ownsLease)await checkpoint({});
  return result;
 } catch(error) {
  if(lease&&ownsLease)try{await checkpoint({});}catch{}
  throw error;
 }
}
