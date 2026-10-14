import { MetaError, MetaGraph } from './metaGraph.ts';
export const facebookPostFields='id,message,created_time,permalink_url,shares';
export function safeMetaMedia(value:unknown):string|null {
 if(typeof value!=='string'||value.length>4096||/(access_token|authorization|appsecret)/i.test(value))return null;
 try {const url=new URL(value);return url.protocol==='https:'&&/(^|\.)(fbcdn\.net|cdninstagram\.com)$/.test(url.hostname)?value:null;}catch{return null;}
}
// Optional Graph operation failures cannot discard authorized core posts. Authority
// guards remain outside catches; invalid tokens still stop the traversal.
function optionalFailure(error:unknown):string {
 if(!(error instanceof MetaError)||error.graphCode===190||(error.code==='meta_permission_or_token_invalid'&&! [10,200].includes(error.graphCode!)))throw error;
 return [10,200].includes(error.graphCode!)?'platform_permission_unavailable':'platform_metric_unavailable';
}
export async function readMetaPosts(graph:MetaGraph,connection:any,token:string,guard:()=>Promise<void>):Promise<{posts:any[];after:string|null}> {
 await guard();const fb=connection.channel==='facebook',scopes=connection.capabilities?.granted_scopes||[];
 const result=await graph.request(`${connection.provider_account_id}/${fb?'posts':'media'}`,token,{fields:fb?facebookPostFields:'id,caption,timestamp,permalink,like_count,comments_count',limit:2,after:connection.sync_after||undefined});
 const posts=[];
 for(const row of result.data||[]) {
  if(!/^\d+(?:_\d+)?$/.test(String(row.id)))continue;
  const metrics:Record<string,number>={},unavailable:Record<string,string>={},provenance:Record<string,unknown>={};
  const put=(name:string,value:unknown,source:string,definition=name)=>{if(typeof value==='number'&&Number.isFinite(value)&&value>=0){metrics[name]=value;delete unavailable[name];provenance[name]={source,period:'lifetime',definition,observed_at:new Date().toISOString(),graph_version:graph.version};}else if(!(name in metrics))unavailable[name]='not_returned';};
  if(fb){
   put('shares',row.shares?.count,'post.shares.count');unavailable.reach='not_supported';unavailable.saves='not_supported';
   for(const [metric,permission] of [['likes','pages_read_engagement'],['reactions','pages_read_user_content'],['comments','pages_read_user_content']]) {
    if(!scopes.includes(permission)){unavailable[metric]='permission_not_granted';continue;}
    await guard();try{const counts=await graph.request(String(row.id),token,{fields:`${metric}.limit(0).summary(true)`});put(metric,counts[metric]?.summary?.total_count,`post.${metric}.summary.total_count`);}catch(error){unavailable[metric]=optionalFailure(error);}
   }
  }else {put('likes',row.like_count,'media.like_count');put('comments',row.comments_count,'media.comments_count');}
  let thumbnail:string|null=null,mediaType:string|null=null,productType:string|null=null;
  const media:any[]=[];
  await guard();
  try {
   const preview=await graph.request(String(row.id),token,{fields:fb?'full_picture,attachments{media_type,type,media,subattachments}':'media_type,media_product_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}'});
   if(fb){
    thumbnail=safeMetaMedia(preview.full_picture);
    const attachments=preview.attachments?.data||[];
    for(const parent of attachments){for(const item of parent.subattachments?.data?.length?parent.subattachments.data:[parent]){
     const image=safeMetaMedia(item.media?.image?.src),source=safeMetaMedia(item.media?.source);
     const video=item.media_type==='video'||String(item.type||'').includes('video');
     if(video&&source)media.push({type:'video',url:source,thumbnail_url:image});else if(image)media.push({type:'image',url:image,previewOnly:video});
    }}
    mediaType=media.length>1?'CAROUSEL_ALBUM':media[0]?.type==='video'?'VIDEO':media.length?'IMAGE':null;
    if(!media.length&&thumbnail)media.push({type:'image',url:thumbnail,previewOnly:true});
   }else {
    mediaType=['IMAGE','VIDEO','CAROUSEL_ALBUM'].includes(preview.media_type)?preview.media_type:null;
    productType=['FEED','REELS','STORY'].includes(preview.media_product_type)?preview.media_product_type:null;
    thumbnail=safeMetaMedia(preview.thumbnail_url)||(mediaType!=='VIDEO'?safeMetaMedia(preview.media_url):null);
    const items=mediaType==='CAROUSEL_ALBUM'?preview.children?.data||[]:[preview];
    for(const item of items){const url=safeMetaMedia(item.media_url);if(url&&['IMAGE','VIDEO'].includes(item.media_type))media.push({type:item.media_type==='VIDEO'?'video':'image',url,thumbnail_url:safeMetaMedia(item.thumbnail_url)});}
   }
  }catch(error){unavailable.preview=optionalFailure(error);}
  const wanted: [string,string][] = fb?[['views','post_media_view'],['viewers','post_total_media_view_unique']]:[['reach','reach'],['views','views'],['interactions','total_interactions'],['shares','shares'],['saves','saved']];
  if(!fb&&productType==='REELS')wanted.push(['watch_time_ms','ig_reels_video_view_total_time'],['avg_watch_time_ms','ig_reels_avg_watch_time']);
  // Each metric is isolated. A media-specific rejection never erases other metrics.
  const insightsAllowed=fb?scopes.includes('read_insights')&&scopes.includes('pages_read_engagement'):Boolean(connection.capabilities?.insights);
  for(const [key,name] of wanted){
   if(!insightsAllowed){unavailable[key]='permission_not_granted';continue;}
   await guard();try{const response=await graph.request(`${row.id}/insights`,token,{metric:name,...(fb?{period:'lifetime'}:{})});const entry=response.data?.find((x:any)=>x.name===name);put(key,entry?.total_value?.value??entry?.values?.[0]?.value,`insights.${name}`);}catch(error){unavailable[key]=optionalFailure(error);}
  }
  if(fb){
   // Insights returns aggregate actions without requiring protected person edges.
   // A missing bucket stays missing. The provider's nonempty action map can be
   // totaled independently; LIKE is already included in all reactions.
   for(const name of ['post_reactions_by_type_total','post_activity_by_action_type']){
    if(!insightsAllowed)continue;
    await guard();try{
     const response=await graph.request(`${row.id}/insights`,token,{metric:name,period:'lifetime'});
     const entry=response.data?.find((x:any)=>x.name===name&&x.period==='lifetime');
     const value=entry?.values?.[0]?.value;
     // A successful aggregate read with omitted buckets is provider absence,
     // not an instruction to reconnect for the separately protected edges.
     for(const key of name==='post_reactions_by_type_total'?['likes','reactions']:['interactions','comments','shares'])if(!(key in metrics))unavailable[key]='not_returned';
     const allowed=name==='post_reactions_by_type_total'?['like','love','wow','haha','sorry','anger','care','sad','angry','thankful','pride']:['like','comment','share'];
     const entries=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];
     if(!entries.length||entries.some(([key,v])=>!allowed.includes(key)||typeof v!=='number'||!Number.isSafeInteger(v)||v<0))continue;
     const total=entries.reduce((n,[,v])=>n+(v as number),0);if(!Number.isSafeInteger(total))continue;
     if(name==='post_reactions_by_type_total'){
      put('reactions',total,`insights.${name}`,'sum_reported_reaction_types');
      if(Object.hasOwn(value,'like'))put('likes',value.like,`insights.${name}.like`,'like_reaction_only');
     }else{
      put('interactions',total,`insights.${name}`,'sum_reported_like_comment_share_actions');
      if(Object.hasOwn(value,'comment'))put('comments',value.comment,`insights.${name}.comment`);
      if(!('shares' in metrics)&&Object.hasOwn(value,'share'))put('shares',value.share,`insights.${name}.share`);
     }
    }catch(error){const reason=optionalFailure(error);for(const key of name==='post_reactions_by_type_total'?['likes','reactions']:['interactions'])if(!(key in metrics))unavailable[key]=reason;}
   }
   if(!('interactions' in metrics)&&['reactions','comments','shares'].every(key=>key in metrics)){
    put('interactions',metrics.reactions+metrics.comments+metrics.shares,'derived.reactions_comments_shares','sum_reactions_comments_shares');
   }
   if(!('interactions' in metrics)&&!unavailable.interactions)unavailable.interactions='complete_counts_unavailable';
  }
  posts.push({thumbnail_url:thumbnail,media:media.slice(0,10),media_type:mediaType,media_product_type:productType,id:String(row.id),caption:fb?row.message:row.caption,permalink:fb?row.permalink_url:row.permalink,published_at:fb?row.created_time:row.timestamp,metrics,metric_provenance:provenance,unavailable_metrics:unavailable});
 }
 const after=result.paging?.next?result.paging?.cursors?.after:null;
 if(result.paging?.next&&!after)throw new MetaError('sync_cursor_unavailable',false,true);
 return {posts,after:after||null};
}
