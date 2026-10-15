import { seal, unseal } from './metaSecurity.ts';
import { DriveError } from './googleDrive.ts';
import { GoogleBusinessProfile, BusinessProfileError, readReviewInbox } from './googleBusinessProfile.ts';
type Call=(action:string,data?:any)=>Promise<any>;
export const businessTokenBinding=(generation:number)=>`google-business:token:${generation}`;
export const businessInboxBinding=(generation:number,mapping:any)=>`google-business:inbox:${generation}:${mapping.location_resource_name}:${mapping.revision}`;
export async function resolveBusinessToken(options:{call:Call;material:any;keys:string[];key:string;grant:(data:any)=>Promise<any>;force?:boolean}) {
 const {call,keys,key,grant}=options;let material=options.material;
 const decode=(value:any)=>unseal(value.sealed_token,keys,businessTokenBinding(value.generation));
 let token=await decode(material);
 if(options.force || Date.parse(material.expires_at)<Date.now()+60000)try {
  const fresh=await grant({grant_type:'refresh_token',refresh_token:token.refresh_token}),renewed={...token,...fresh};
  const saved=await call('refresh',{generation:material.generation,expected_token:material.sealed_token,sealed_token:await seal(renewed,key,businessTokenBinding(material.generation)),expires_at:new Date(Date.now()+fresh.expires_in*1000).toISOString()});
  if(saved.updated)token=renewed;else{material=await call('material');token=await decode(material);}
 }catch(error){
  if(!(error instanceof DriveError)||error.code!=='reconnect_required')throw error;
  const current=await call('material');
  if(current.generation===material.generation && JSON.stringify(current.sealed_token)!==JSON.stringify(material.sealed_token) && Date.parse(current.expires_at)>Date.now()+60000){material=current;token=await decode(current);}
  else{await call('expired',{generation:material.generation,expected_token:material.sealed_token});throw error;}
 }
 return {material,token};
}
export function syncFailure(error:any) {
 const code=error instanceof DriveError && error.code==='drive_unavailable' ? 'google_unavailable' : error instanceof BusinessProfileError || error instanceof DriveError ? error.code : 'google_unavailable';
 return {error_code:code,error_service:error.service || (error instanceof DriveError ? 'oauth2.googleapis.com' : 'mybusiness.googleapis.com'),error_request:error.request || (error instanceof DriveError ? 'POST /token' : 'GET reviews')};
}
// Manual and scheduled sync share this one complete-page/lease/refresh/save authority.
export async function synchronizeBusinessReviews(options:{call:Call;key:string;keys:string[];grant:(data:any)=>Promise<any>;transport?:typeof fetch;deadline?:number}) {
 const {call,key,keys,grant}=options;let material=await call('material');
 if(!material.mapping?.outlet_id)throw new Error('Map this outlet to a Google location in Settings.');
 const basis={generation:material.generation,revision:material.mapping.revision};
 const lease=await call('sync_begin',basis);
 try {
  const resolved=await resolveBusinessToken({call,material,keys,key,grant});material=resolved.material;
  const provider=new GoogleBusinessProfile(resolved.token.access_token,options.transport,options.deadline);
  const snapshot=await readReviewInbox(provider,material.mapping.location_resource_name);
  await call('sync_finish',{...basis,lease:lease.lease,sealed_reviews:await seal(snapshot,key,businessInboxBinding(basis.generation,material.mapping))});
  return {ok:true};
 }catch(error){
  console.warn(JSON.stringify({integration:'google-business',action:'sync',...syncFailure(error)}));
  await call('sync_error',{...basis,lease:lease.lease,...syncFailure(error)}).catch(()=>{});
  if((error instanceof BusinessProfileError || error instanceof DriveError) && error.code==='reconnect_required')await call('expired',{generation:material.generation,expected_token:material.sealed_token}).catch(()=>{});
  throw error;
 }
}
export async function runScheduledReviewSync(outlets:string[],sync:(outlet:string)=>Promise<any>,options:{now?:()=>number;sleep?:(ms:number)=>Promise<void>;deadline?:number}={}) {
 const now=options.now || Date.now,sleep=options.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms))),deadline=options.deadline || now()+105000;
 let succeeded=0,failed=0,stopped='';
 for(const outlet of outlets){
  if(now()>deadline-5000){stopped='time_budget';break;}
  for(let attempt=0;attempt<2;attempt++)try{await sync(outlet);succeeded++;break;}catch(error){
   const code=syncFailure(error).error_code;
   if(code==='google_unavailable' && attempt===0 && now()<deadline-7000){await sleep(1000);continue;}
   failed++;
   if(['google_rate_limited','reconnect_required'].includes(code))stopped=code;
   break;
  }
  if(stopped)break;
 }
 return {succeeded,failed,stopped};
}
