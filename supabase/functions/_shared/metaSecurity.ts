const encoder = new TextEncoder();
export const STAGING_ORIGIN = 'https://fnb-system-staging.vercel.app';
export const STAGING_SUPABASE = 'https://ujkzdaaadnvcfayuldmh.supabase.co';
export const META_BASE = `${STAGING_SUPABASE}/functions/v1/marketing-meta`;
export const META_REDIRECT = `${META_BASE}/callback`;
export const META_SCOPES = ['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish','read_insights','instagram_manage_insights','pages_manage_metadata','business_management'];
export function base64url(bytes: Uint8Array): string { const parts:string[]=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
 if (!/^[A-Za-z0-9_+/=-]+$/.test(value)) throw new Error('Invalid encoding.');
 const normalized=value.replaceAll('-','+').replaceAll('_','/');
 return Uint8Array.from(atob(normalized+'='.repeat((4-normalized.length%4)%4)),c=>c.charCodeAt(0));
}
export async function hash(value: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join(''); }
export function nonce(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export type Sealed = { version: 1; keyId: string; iv: string; ciphertext: string };
export async function seal(value: unknown, secret: string, binding: string): Promise<Sealed> {
 const raw=unbase64(secret); if(raw.length!==32)throw new Error('Token encryption configuration is unavailable.');
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(binding)},key,encoder.encode(JSON.stringify(value)));
 return {version:1,keyId:(await hash(secret)).slice(0,16),iv:base64url(iv),ciphertext:base64url(new Uint8Array(cipher))};
}
export async function unseal(value: Sealed, secrets: string[], binding: string): Promise<any> {
 if(value?.version!==1)throw new Error('Stored credential is unavailable.');
 for(const secret of secrets.filter(Boolean)) {
  if((await hash(secret)).slice(0,16)!==value.keyId)continue;
  const raw=unbase64(secret);if(raw.length!==32)continue;
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(value.iv),additionalData:encoder.encode(binding)},key,unbase64(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
 }
 throw new Error('Reconnect this account to renew its credential.');
}
export async function verifySignedRequest(signed: string, appSecret: string, now=Date.now()): Promise<{user_id:string;issued_at:number}> {
 if(signed.length>16000)throw new Error('Invalid Meta signature.');
 const parts=signed.split('.');if(parts.length!==2)throw new Error('Invalid Meta signature.');
 const key=await crypto.subtle.importKey('raw',encoder.encode(appSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,unbase64(parts[0]),encoder.encode(parts[1])))throw new Error('Invalid Meta signature.');
 const data=JSON.parse(new TextDecoder().decode(unbase64(parts[1])));
 if(data.algorithm!=='HMAC-SHA256'||!/^\d+$/.test(data.user_id)||!Number.isFinite(data.issued_at)||data.issued_at<=0||data.issued_at*1000>now+300000)throw new Error('Invalid Meta removal request.');
 return {user_id:String(data.user_id),issued_at:data.issued_at};
}
export function connectionBinding(c:{brand_id:string;channel:string;provider_account_id:string}):string { return `meta:${c.brand_id}:${c.channel}:${c.provider_account_id}`; }
export function authorizationUrl(config:{appId:string;configId:string;version:string},state:string):string {
 if(!/^\d+$/.test(config.appId)||!/^\d+$/.test(config.configId)||!/^v\d+\.0$/.test(config.version))throw new Error('Meta OAuth configuration is unavailable.');
 const url=new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
 for(const [key,value] of Object.entries({client_id:config.appId,config_id:config.configId,redirect_uri:META_REDIRECT,response_type:'code',override_default_response_type:'true',state,auth_type:'rerequest'}))url.searchParams.set(key,value);
 return url.toString();
}
