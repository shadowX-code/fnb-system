import { META_REDIRECT } from './metaSecurity.ts';
export class MetaError extends Error {
 constructor(public code:string,public uncertain=false,public retryable=false) { super(code); }
}
export type MetaConfig={appId:string;appSecret:string;configId:string;version:string};
export class MetaGraph {
 constructor(private config:MetaConfig,private transport:typeof fetch=fetch) {
  if(!/^v\d+\.0$/.test(config.version))throw new MetaError('meta_version_not_configured');
 }
 async request(path:string,token:string,params:Record<string,any>={},method='GET'):Promise<any> {
  if(!/^\/?(?:\d+(?:_\d+)?|me|oauth|debug_token)(?:\/[a-z_]+)?$/.test(path))throw new MetaError('invalid_meta_endpoint');
  const url=new URL(`https://graph.facebook.com/${this.config.version}/${path.replace(/^\//,'')}`);
  const form=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value!==undefined&&value!==null)form.set(key,typeof value==='object'?JSON.stringify(value):String(value));
  if(method==='GET')url.search=form.toString();
  let response:Response;
  try { response=await this.transport(url,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(method!=='GET'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:method==='GET'?undefined:form.toString(),signal:AbortSignal.timeout(20000),redirect:'error'}); }
  catch { throw new MetaError('meta_response_uncertain',method!=='GET',method==='GET'); }
  let body:any;
  try { const text=await response.text();if(text.length>2000000)throw new Error();body=JSON.parse(text); }
  catch {throw new MetaError('meta_response_unreadable',method!=='GET',method==='GET');}
  if(!response.ok||body.error) {
   const code=Number(body.error?.code); const auth=[10,190,200].includes(code);
   // Errors do not include raw messages, tokens, URLs or provider response bodies.
   throw new MetaError(auth?'meta_permission_or_token_invalid':`meta_error_${Number.isFinite(code)?code:response.status}`,method!=='GET'&&response.status>=500,Boolean(body.error?.is_transient)||response.status===429||response.status>=500);
  }
  return body;
 }
 async exchange(code:string):Promise<{userId:string;expiresAt:string;accounts:any[];tokens:Record<string,string>}> {
  if(!code||code.length>4096)throw new MetaError('invalid_oauth_code');
  const short=await this.request('oauth/access_token','',{client_id:this.config.appId,client_secret:this.config.appSecret,redirect_uri:META_REDIRECT,code});
  if(typeof short.access_token!=='string')throw new MetaError('missing_oauth_token');
  const long=await this.request('oauth/access_token','',{grant_type:'fb_exchange_token',client_id:this.config.appId,client_secret:this.config.appSecret,fb_exchange_token:short.access_token});
  if(typeof long.access_token!=='string')throw new MetaError('missing_oauth_token');
  const debug=(await this.request('debug_token',`${this.config.appId}|${this.config.appSecret}`,{input_token:long.access_token})).data;
  if(!debug?.is_valid||String(debug.app_id)!==this.config.appId||!/^\d+$/.test(String(debug.user_id)))throw new MetaError('oauth_app_or_user_mismatch');
  if([debug.expires_at,debug.data_access_expires_at].some(v=>Number(v)>0&&Number(v)<=Date.now()/1000))throw new MetaError('token_expired');
  const limits=[debug.expires_at,debug.data_access_expires_at,Math.floor(Date.now()/1000)+Number(long.expires_in||0)].map(Number).filter(v=>Number.isFinite(v)&&v>Date.now()/1000);
  if(!limits.length)throw new MetaError('unknown_token_expiry');
  const expiresAt=new Date(Math.min(...limits)*1000).toISOString();
  const scopes=new Set<string>(debug.scopes||[]);
  if(!scopes.has('pages_show_list'))throw new MetaError('pages_show_list_not_granted');
  const accounts:any[]=[], tokens:Record<string,string>={};let after:string|undefined;
  for(let page=0;page<10;page++) {
   const result=await this.request('me/accounts',long.access_token,{fields:'id,name,access_token,tasks,instagram_business_account{id,username}',limit:50,after});
   for(const row of result.data||[]) {
    if(!/^\d+$/.test(row.id)||typeof row.access_token!=='string')continue;
    const permitted=(scope:string)=>scopes.has(scope)&&(!(debug.granular_scopes||[]).some((g:any)=>g.scope===scope&&g.target_ids?.length)|| (debug.granular_scopes||[]).some((g:any)=>g.scope===scope&&g.target_ids?.some((id:string)=>[row.id,row.instagram_business_account?.id].includes(id))));
    const create=(row.tasks||[]).some((x:string)=>['CREATE_CONTENT','MANAGE','PROFILE_PLUS_CREATE_CONTENT','PROFILE_PLUS_FULL_CONTROL'].includes(x));
    const fb={id:row.id,name:String(row.name||'Facebook Page').slice(0,200),channel:'facebook',capabilities:{publishing:permitted('pages_manage_posts')&&permitted('pages_read_engagement')&&create,posts:permitted('pages_read_engagement'),insights:permitted('read_insights'),formats:['text','image','carousel'],granted_scopes:[...scopes]}};
    accounts.push(fb);tokens[`facebook:${row.id}`]=row.access_token;
    const ig=row.instagram_business_account;
    if(ig&&/^\d+$/.test(ig.id)) {
     accounts.push({id:ig.id,name:String(ig.username||`${row.name} Instagram`).slice(0,200),channel:'instagram',capabilities:{publishing:permitted('instagram_basic')&&permitted('instagram_content_publish')&&create,posts:permitted('instagram_basic'),insights:permitted('instagram_manage_insights'),formats:['image','carousel','reel'],granted_scopes:[...scopes]},page_id:row.id});
     tokens[`instagram:${ig.id}`]=row.access_token;
    }
   }
   after=result.paging?.cursors?.after;if(!result.paging?.next)break;
   if(!after||page===9)throw new MetaError('account_discovery_limit_reached');
  }
  return {userId:String(debug.user_id),expiresAt,accounts,tokens};
 }
}
