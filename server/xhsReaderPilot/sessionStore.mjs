import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
// One isolated pilot session; no browser profile or plaintext cookie file.
export function sessionStore(path,key,scope){
 const secret=Buffer.from(key||'','base64');if(secret.length!==32||secret.toString('base64')!==key)throw new Error('reader_key_invalid');
 const aad=Buffer.from('feedx-xhs-reader-v1:'+scope);
 return {
  async save(state){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad);const encrypted=Buffer.concat([cipher.update(JSON.stringify(state)),cipher.final()]);await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.'+randomBytes(8).toString('hex');try{await writeFile(tmp,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{mode:0o600,flag:'wx'});await rename(tmp,path)}finally{await rm(tmp,{force:true})}},
  async load(){let text;try{text=await readFile(path,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw new Error('reader_session_unavailable')}try{const value=JSON.parse(text);if(value.v!==1)throw new Error();const decipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(value.iv,'base64'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString())}catch{throw new Error('reader_session_unavailable')}},
  async clear(){await rm(path,{force:true})}
 };
}
