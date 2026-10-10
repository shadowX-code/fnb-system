import { MetaError, MetaGraph } from './metaGraph.ts';
export const facebookPostFields='id,message,created_time,permalink_url,shares';
export async function readMetaPosts(graph:MetaGraph,connection:any,token:string,guard:()=>Promise<void>):Promise<{posts:any[];after:string|null}> {
 await guard();
 const fb=connection.channel==='facebook';
 const result=await graph.request(`${connection.provider_account_id}/${fb?'posts':'media'}`,token,{fields:fb?facebookPostFields:'id,caption,timestamp,permalink,like_count,comments_count',limit:2,after:connection.sync_after||undefined});
 const posts=[];
 for(const row of result.data||[]) {
  if(!/^\d+(?:_\d+)?$/.test(String(row.id)))continue;
  const metrics:Record<string,number>={},unavailable:Record<string,string>={};
  const put=(name:string,value:any)=>{if(typeof value==='number'&&Number.isFinite(value)&&value>=0)metrics[name]=value;else unavailable[name]='not_returned';};
  if(fb){
   put('shares',row.shares?.count);unavailable.reach='not_available_in_adapter';unavailable.views='not_available_in_adapter';
   // Optional engagement edges have separate operation permissions. Never let their
   // denial discard authorized Page posts, or present unavailable counts as zero.
   for(const [metric,permission] of [['likes','pages_read_engagement'],['comments','pages_read_user_content']]) {
    if(!connection.capabilities?.granted_scopes?.includes(permission)){unavailable[metric]='permission_not_granted';continue;}
    await guard();
    try{const counts=await graph.request(String(row.id),token,{fields:`${metric}.limit(0).summary(true)`});put(metric,counts[metric]?.summary?.total_count);}
    catch(error){
     if(!(error instanceof MetaError)||error.graphCode===190||(error.code==='meta_permission_or_token_invalid'&&![10,200].includes(error.graphCode!)))throw error;
     unavailable[metric]=[10,200].includes(error.graphCode!)?'platform_permission_unavailable':'platform_metric_unavailable';
    }
   }
  }
  else {put('likes',row.like_count);put('comments',row.comments_count);}

  if(!fb&&connection.capabilities?.insights) {
   try {
    await guard();const insights=await graph.request(`${row.id}/insights`,token,{metric:'reach,views'});
    for(const metric of ['reach','views']){const entry=insights.data?.find((x:any)=>x.name===metric);put(metric,entry?.total_value?.value??entry?.values?.[0]?.value);}
   }catch(error){if(error instanceof MetaError&&error.code==='meta_permission_or_token_invalid')throw error;unavailable.reach='platform_metric_unavailable';unavailable.views='platform_metric_unavailable';}
  }else if(!fb){unavailable.reach='permission_not_granted';unavailable.views='permission_not_granted';}
  // Preview fields are optional: denied/unsupported previews never discard authorized posts.
  let thumbnail:string|null=null;
  await guard();
  try {
   const preview=await graph.request(String(row.id),token,{fields:fb?'full_picture':'media_type,media_url,thumbnail_url'});
   const candidate=fb?preview?.full_picture:preview?.thumbnail_url||(preview?.media_type!=='VIDEO'?preview?.media_url:null);
   if(typeof candidate==='string') {
    let url:URL|null=null;try{url=new URL(candidate);}catch{/* Malformed optional preview. */}
    if(url?.protocol==='https:'&&/(^|\.)(fbcdn\.net|cdninstagram\.com)$/.test(url.hostname)&&!/(access_token|authorization|appsecret)/i.test(candidate)&&candidate.length<=4096)thumbnail=candidate;
   }
  } catch(error) {
   if(!(error instanceof MetaError)||error.graphCode===190||(error.code==='meta_permission_or_token_invalid'&&![10,200].includes(error.graphCode!)))throw error;
   unavailable.preview='platform_preview_unavailable';
  }
  posts.push({thumbnail_url:thumbnail,id:String(row.id),caption:fb?row.message:row.caption,permalink:fb?row.permalink_url:row.permalink,published_at:fb?row.created_time:row.timestamp,metrics,unavailable_metrics:unavailable});
 }
 const after=result.paging?.next?result.paging?.cursors?.after:null;
 if(result.paging?.next&&!after)throw new MetaError('sync_cursor_unavailable',false,true);
 return {posts,after:after||null};
}
