// Read-only Google Drive v3 transport. No browser-supplied URL is ever fetched.
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_FOLDER='application/vnd.google-apps.folder';
export const DRIVE_SHORTCUT='application/vnd.google-apps.shortcut';
export const DRIVE_FIELDS='id,name,mimeType,size,version,md5Checksum,modifiedTime,parents,trashed,driveId,shortcutDetails,capabilities(canDownload),webViewLink';
export class DriveError extends Error { constructor(public code:string,public status=400){super(code);} }
export function driveId(value:unknown):string {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(value))throw new DriveError('invalid_file');return value;}
export class GoogleDrive {
 private cache=new Map<string,any>();
 constructor(private token:string,private transport:typeof fetch=fetch){}
 async request(path:string,query:Record<string,string>={}) {
  const url=new URL('https://www.googleapis.com/drive/v3/'+path);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  const response=await this.transport(url,{headers:{Authorization:`Bearer ${this.token}`},redirect:'error'});
  if(!response.ok)throw new DriveError(response.status===401?'reconnect_required':response.status===403?'drive_permission_required':response.status===404?'file_unavailable':'drive_unavailable',response.status);
  return response;
 }
 async file(id:string){id=driveId(id);if(!this.cache.has(id))this.cache.set(id,await(await this.request('files/'+id,{fields:DRIVE_FIELDS,supportsAllDrives:'true'})).json());return this.cache.get(id);}
 async inside(id:string,root:string):Promise<boolean> {
  driveId(root);let pending=[driveId(id)],seen=new Set<string>();
  for(let i=0;pending.length&&i<100;i++){
   const next=pending.shift()!;if(seen.has(next))continue;seen.add(next);
   const file=await this.file(next);if(file.trashed)continue;if(next===root)return true;
   pending.push(...(file.parents||[]));
  }return false;
 }
 async scoped(id:string,root:string){if(!await this.inside(id,root))throw new DriveError('outside_brand_folder',403);const node=await this.file(id);
  if(node.mimeType!==DRIVE_SHORTCUT)return {node,file:node};
  const target=node.shortcutDetails?.targetId;if(!target||!await this.inside(target,root))throw new DriveError('shortcut_outside_brand_folder',403);
  const file=await this.file(target);if(file.mimeType===DRIVE_SHORTCUT)throw new DriveError('unsupported_shortcut');return {node,file};
 }
 async list(folder:string,search='',type='',after=''){
  driveId(folder);if(search.length>100)throw new DriveError('search_too_long');
  const escaped=search.replaceAll('\\','\\\\').replaceAll("'","\\'");
  const q=['trashed = false',search?`name contains '${escaped}'`:`'${folder}' in parents`];
  if(type==='folders')q.push(`mimeType = '${DRIVE_FOLDER}'`);
  const data=await(await this.request('files',{q:q.join(' and '),fields:`nextPageToken,files(${DRIVE_FIELDS})`,pageSize:'50',orderBy:'folder,name',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(after?{pageToken:after}:{})})).json();return data;
 }
 async download(file:any):Promise<Uint8Array> {
  if(!['image/jpeg','image/png','image/webp','video/mp4'].includes(file.mimeType)||!file.capabilities?.canDownload||!Number.isSafeInteger(Number(file.size))||Number(file.size)<1||Number(file.size)>104857600)throw new DriveError('media_format_unavailable');
  const response=await this.request('files/'+driveId(file.id),{alt:'media',supportsAllDrives:'true'});
  const reader=response.body?.getReader();if(!reader)throw new DriveError('media_unavailable');const parts:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>104857600){await reader.cancel();throw new DriveError('media_too_large');}parts.push(value);}
  if(length!==Number(file.size))throw new DriveError('source_changed');const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  this.cache.delete(file.id);const latest=await this.file(file.id);if(latest.version!==file.version||latest.md5Checksum!==file.md5Checksum)throw new DriveError('source_changed');return bytes;
 }
}
export function verifySnapshot(bytes:Uint8Array,mime:string){
 const signature=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':mime==='video/mp4'?new TextDecoder().decode(bytes.slice(4,8))==='ftyp':false;
 if(!signature||bytes.length>104857600)throw new DriveError('media_format_mismatch');
}
export async function byteHash(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('');}
