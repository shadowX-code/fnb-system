import { MetaError, MetaGraph } from './metaGraph.ts';
export async function readMetaPosts(graph:MetaGraph,connection:any,token:string,guard:()=>Promise<void>):Promise<{posts:any[];after:string|null}> {
 await guard();
 const fb=connection.channel==='facebook';
 const result=await graph.request(`${connection.provider_account_id}/${fb?'posts':'media'}`,token,{fields:fb?'id,message,created_time,permalink_url,shares,likes.limit(0).summary(true),comments.limit(0).summary(true)':'id,caption,timestamp,permalink,like_count,comments_count',limit:2,after:connection.sync_after||undefined});
 const posts=[];
 for(const row of result.data||[]) {
  if(!/^\d+(?:_\d+)?$/.test(String(row.id)))continue;
  const metrics:Record<string,number>={},unavailable:Record<string,string>={};
  const put=(name:string,value:any)=>{if(typeof value==='number'&&Number.isFinite(value)&&value>=0)metrics[name]=value;else unavailable[name]='not_returned';};
  put('likes',fb?row.likes?.summary?.total_count:row.like_count);put('comments',fb?row.comments?.summary?.total_count:row.comments_count);
  if(fb){put('shares',row.shares?.count);unavailable.reach='not_available_in_adapter';unavailable.views='not_available_in_adapter';}
  else if(connection.capabilities?.insights) {
   try {
    await guard();const insights=await graph.request(`${row.id}/insights`,token,{metric:'reach,views'});
    for(const metric of ['reach','views']){const entry=insights.data?.find((x:any)=>x.name===metric);put(metric,entry?.total_value?.value??entry?.values?.[0]?.value);}
   }catch(error){if(error instanceof MetaError&&error.code==='meta_permission_or_token_invalid')throw error;unavailable.reach='platform_metric_unavailable';unavailable.views='platform_metric_unavailable';}
  }else{unavailable.reach='permission_not_granted';unavailable.views='permission_not_granted';}
  posts.push({id:String(row.id),caption:fb?row.message:row.caption,permalink:fb?row.permalink_url:row.permalink,published_at:fb?row.created_time:row.timestamp,metrics,unavailable_metrics:unavailable});
 }
 const after=result.paging?.next?result.paging?.cursors?.after:null;
 if(result.paging?.next&&!after)throw new MetaError('sync_cursor_unavailable',false,true);
 return {posts,after:after||null};
}
