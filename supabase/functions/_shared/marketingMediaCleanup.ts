// One canonical claim and at most one storage deletion per idle tick.
export async function cleanupTemporaryMedia(db:any,remove:(path:string,signal:AbortSignal)=>Promise<void>,signal=AbortSignal.timeout(3000)){
 const claim=await db.rpc('marketing_media_cleanup_claim').abortSignal(signal);if(claim.error)throw new Error('cleanup_claim_unavailable');
 const asset=claim.data;if(!asset)return false;
 await remove(asset.object_path,signal);
 const finish=await db.rpc('marketing_media_cleanup_finish',{p_asset:asset.id,p_lease:asset.cleanup_lease}).abortSignal(signal);
 if(finish.error)throw new Error('cleanup_reconciliation_pending');return true;
}
