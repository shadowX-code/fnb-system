import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import {STAGING_ORIGIN,STAGING_SUPABASE,hash,nonce,seal,unseal,base64url,tokenEncryptionReady} from '../_shared/metaSecurity.ts';
import {GoogleDrive,DriveError,DRIVE_SCOPE,DRIVE_FOLDER,DRIVE_SHORTCUT,driveId,verifySnapshot,byteHash} from '../_shared/googleDrive.ts';
import {verifyMetaMedia} from '../_shared/metaPublishing.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const REDIRECT=STAGING_SUPABASE+'/functions/v1/marketing-drive/callback';
const configured=()=>['CLIENT_ID','CLIENT_SECRET','TOKEN_ENCRYPTION_KEY'].every(n=>env('MARKETING_GOOGLE_DRIVE_'+n));
const binding=(org:string,generation:number)=>`drive:${org}:${generation}`;
const messages:Record<string,string>={reconnect_required:'Reconnect Google Drive in Marketing Settings.',drive_permission_required:'Google Drive access is unavailable. Check the folder sharing and connection.',outside_brand_folder:'This file is outside the selected brand folder.',shortcut_outside_brand_folder:'This shortcut points outside the brand folder.',source_changed:'The Drive file changed. Refresh and select it again.',media_format_mismatch:'The file content does not match its media format.',media_format_unavailable:'Select a downloadable JPG, PNG, WebP or MP4 up to 100 MB.',file_unavailable:'The file or folder is no longer available.',drive_unavailable:'Google Drive is unavailable. Try again.'};
Deno.serve(async req=>{
 const headers={'Access-Control-Allow-Origin':STAGING_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(env('SUPABASE_URL')!==STAGING_SUPABASE)return reply({error:'Staging integration only.'},403);
 const action=new URL(req.url).pathname.split('/').pop()!;
 if(action==='configuration'&&req.method==='GET'){
  const encryptionKeyValid=await tokenEncryptionReady(env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'));
  return reply({configured:Boolean(configured())&&encryptionKeyValid,encryptionKeyValid,redirectUri:REDIRECT,scope:DRIVE_SCOPE});
 }
 const db=createClient(STAGING_SUPABASE,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 let user:string|null=null,org:string|null=null,brand:string|null=null;
 const call=async(name:string,data:any={})=>{const result=await db.rpc('marketing_drive_server',{p_action:name,p_user:user,p_org:org,p_brand:brand,p_data:data});if(result.error)throw new Error(result.error.message);return result.data;};
 const encrypt=(value:any,generation:number)=>seal(value,env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'),binding(org!,generation));
 async function grant(params:Record<string,string>){const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...params,client_id:env('MARKETING_GOOGLE_DRIVE_CLIENT_ID'),client_secret:env('MARKETING_GOOGLE_DRIVE_CLIENT_SECRET')}),redirect:'error'});if(!response.ok)throw new DriveError('reconnect_required',401);const data=await response.json();if(!data.access_token)throw new DriveError('reconnect_required');return data;}
 try{
  if(action==='callback'&&req.method==='GET'){
   if(!configured())throw new Error('Google Drive is not configured.');const url=new URL(req.url),state=url.searchParams.get('state')||'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw new Error('Invalid authorization state.');
   const session=await call('oauth_consume',{state_hash:await hash(state)});org=session.organization_id;
   if(url.searchParams.has('error'))throw new Error('Google authorization was not completed.');
   const verifier=await unseal(session.sealed_verifier,[env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY')],`drive-state:${await hash(state)}`);
   const token=await grant({grant_type:'authorization_code',code:url.searchParams.get('code')||'',redirect_uri:REDIRECT,code_verifier:verifier.value});
   if(!token.scope?.split(' ').includes(DRIVE_SCOPE))throw new Error('Read-only Drive permission was not granted.');
   const drive=new GoogleDrive(token.access_token),about=await(await drive.request('about',{fields:'user(displayName,emailAddress,permissionId)'})).json();
   // Reconnect must provide offline credentials. Never silently retain another identity's refresh token.
   if(!token.refresh_token||!about.user?.permissionId)throw new Error('Offline Drive authorization is unavailable. Reconnect with consent.');
   await call('oauth_finish',{state_hash:await hash(state),account:about.user,sealed_token:await encrypt(token,session.generation+1),expires_at:new Date(Date.now()+token.expires_in*1000).toISOString()});
   return Response.redirect(`${STAGING_ORIGIN}/marketing/settings?drive_result=connected&marketing_org=${org}`,303);
  }
  if(req.method!=='POST')return reply({error:'Endpoint unavailable.'},404);
  const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({error:'Sign in to FeedX.'},401);
  const {data,error}=await db.auth.getUser(auth.slice(7));if(error||!data.user)return reply({error:'Sign in again.'},401);user=data.user.id;
  if(Number(req.headers.get('content-length')||0)>32000)throw new Error('Request too large.');const body=await req.json();org=body.organizationId;brand=body.brandId||null;
  if(!org||typeof org!=='string')throw new Error('Select an organization.');
  if(action==='context')return reply(await call('context'));
  if(action==='prepare-upload')return reply(await call('prepare',{source_kind:'device',filename:body.filename,mime_type:body.mime,size_bytes:body.size}));
  if(action==='finalize-upload'){
   // Material is not required for device uploads; use the canonical scoped asset read model.
   const {data:assets,error}=await db.rpc('marketing_drive_asset',{p_user:user,p_asset:body.assetId});if(error)throw new Error('Media access unavailable.');const asset=assets;
   if(asset.organization_id!==org||asset.brand_id!==brand)throw new Error('Media scope changed.');
   const download=await db.storage.from('marketing-media').download(asset.object_path);if(download.error||!download.data||download.data.size!==Number(asset.size_bytes))throw new Error('Uploaded media unavailable.');
   const bytes=new Uint8Array(await download.data.arrayBuffer());verifySnapshot(bytes,asset.mime_type);if(['facebook','instagram'].includes(body.channel))verifyMetaMedia(bytes,asset.mime_type,body.channel);
   return reply(await call('finalize',{id:asset.id,sha256:await byteHash(bytes)}));
  }
  if(action==='disconnect'){await call('disconnect');return reply({ok:true});}
  if(!configured())throw new Error('An organization administrator must configure Google Drive before connecting.');
  if(action==='authorize'){
   const state=nonce(),verifier=nonce();await call('begin',{state_hash:await hash(state),sealed_verifier:await seal({value:verifier},env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'),`drive-state:${await hash(state)}`)});
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [k,v] of Object.entries({client_id:env('MARKETING_GOOGLE_DRIVE_CLIENT_ID'),redirect_uri:REDIRECT,response_type:'code',scope:DRIVE_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),code_challenge_method:'S256'}))url.searchParams.set(k,v);
   return reply({url:url.toString()});
  }
  const material=await call('material');let token=await unseal(material.sealed_token,[env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'),env('MARKETING_GOOGLE_DRIVE_PREVIOUS_TOKEN_ENCRYPTION_KEY')],binding(org!,material.generation));
  if(new Date(material.expires_at).getTime()<Date.now()+60000){try{const fresh=await grant({grant_type:'refresh_token',refresh_token:token.refresh_token});token={...token,...fresh};await call('refresh',{generation:material.generation,sealed_token:await encrypt(token,material.generation),expires_at:new Date(Date.now()+fresh.expires_in*1000).toISOString()});}catch(error){await call('expired',{generation:material.generation});throw error;}}
  const drive=new GoogleDrive(token.access_token),root=material.root;
  if(action==='folders'){
   if(!(await call('context')).can_manage)throw new Error('Organization administrator access required.');
   return reply(await drive.list(body.folderId||'root',body.search||'','folders',body.after||''));
  }
  if(action==='map'){
   if(!(await call('context')).can_manage||body.confirmOwnership!==true)throw new Error('Confirm this folder belongs to the selected brand.');
   const file=await drive.file(driveId(body.rootId));if(file.mimeType!==DRIVE_FOLDER||file.trashed)throw new Error('Select an available Drive folder.');
   for(const other of material.mappings||[])if(other.brand_id!==brand&&(await drive.inside(file.id,other.root_id)||await drive.inside(other.root_id,file.id)))throw new Error('This folder overlaps another brand’s mapped folder.');
   if(body.favoritesId){const favorite=await drive.scoped(body.favoritesId,file.id);if(favorite.file.mimeType!==DRIVE_FOLDER)throw new Error('Favorites must be a folder inside the brand root.');}
   await call('map',{root_id:file.id,root_name:file.name,favorites_id:body.favoritesId||null,generation:material.generation,mappings:material.mappings});return reply({ok:true});
  }
  if(!brand||!root||root.generation!==material.generation)throw new Error('Map a folder for this brand in Marketing Settings.');
  const guard=()=>call('guard',{generation:material.generation,revision:root.revision});await guard();
  if(action==='browse'){
   const folder=await drive.scoped(body.folderId||root.root_id,root.root_id);if(folder.file.mimeType!==DRIVE_FOLDER)throw new Error('Select a folder.');
   const search=String(body.search||''),type=String(body.type||'');let after='';
   if(body.cursor){const cursor=await unseal(body.cursor,[env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY')],`drive-cursor:${org}:${brand}:${root.revision}`);if(cursor.expires<Date.now()||cursor.folder!==folder.file.id||cursor.search!==search||cursor.type!==type)throw new Error('Refresh the library.');after=cursor.after;}
   const found=await drive.list(folder.file.id,search,type,after),files=[];
   for(const node of found.files||[]){try{const scoped=await drive.scoped(node.id,root.root_id),file=scoped.file;
    if(![DRIVE_FOLDER,'image/jpeg','image/png','image/webp','video/mp4'].includes(file.mimeType)||type==='image'&&!file.mimeType.startsWith('image/')&&file.mimeType!==DRIVE_FOLDER||type==='video'&&!file.mimeType.startsWith('video/')&&file.mimeType!==DRIVE_FOLDER)continue;
    files.push({...file,name:node.name,selection_id:node.id,is_shortcut:node.mimeType===DRIVE_SHORTCUT});
   }catch(error){if(!(error instanceof DriveError))throw error;/* Inaccessible candidates are never returned. */}}
   await guard();return reply({files,root,folder:{id:folder.file.id,name:folder.node.name},cursor:found.nextPageToken?await seal({after:found.nextPageToken,folder:folder.file.id,search,type,expires:Date.now()+900000},env('MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'),`drive-cursor:${org}:${brand}:${root.revision}`):null});
  }
  if(action==='preview'||action==='import'){
   const scoped=await drive.scoped(driveId(body.fileId),root.root_id),file=scoped.file;
   if(body.version&&body.version!==file.version)throw new DriveError('source_changed');
   const bytes=await drive.download(file);verifySnapshot(bytes,file.mimeType);if(action==='import'&&['facebook','instagram'].includes(body.channel))verifyMetaMedia(bytes,file.mimeType,body.channel);await guard();
   if(action==='preview')return new Response(bytes as Uint8Array<ArrayBuffer>,{headers:{...headers,'Content-Type':file.mimeType,'X-Content-Type-Options':'nosniff'}});
   const asset=await call('prepare',{filename:file.name,mime_type:file.mimeType,size_bytes:bytes.length,source_kind:'drive',generation:material.generation,revision:root.revision,sha256:await byteHash(bytes),source_metadata:{file_id:file.id,selection_id:scoped.node.id,version:file.version,modified_at:file.modifiedTime,md5:file.md5Checksum||null,root_id:root.root_id,mapping_revision:root.revision}});
   if(asset.reused)return reply(asset);const upload=await db.storage.from('marketing-media').upload(asset.object_path,bytes,{contentType:file.mimeType,upsert:false});if(upload.error)throw new Error('Publishing snapshot upload failed. Retry selection.');
   await guard();return reply(await call('finalize',{id:asset.id,sha256:await byteHash(bytes)}));
  }
  return reply({error:'Endpoint unavailable.'},404);
 }catch(error){if(action==='callback')return Response.redirect(`${STAGING_ORIGIN}/marketing/settings?drive_result=failed`,303);const code=error instanceof DriveError?error.code:'drive_request_rejected';return reply({error:error instanceof DriveError?messages[code]||'Google Drive request could not be completed.':error instanceof Error?error.message:'Media request unavailable.',code},error instanceof DriveError?Math.min(error.status,503):400);}
});
