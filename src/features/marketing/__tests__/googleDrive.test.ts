import {describe,it,expect,vi} from 'vitest';
import {GoogleDrive,DriveError,DRIVE_FOLDER,DRIVE_SHORTCUT,verifySnapshot} from '../../../../supabase/functions/_shared/googleDrive.ts';
const nodes:any={root:{id:'root',mimeType:DRIVE_FOLDER},brand:{id:'brand',parents:['root'],mimeType:DRIVE_FOLDER},inside:{id:'inside',parents:['brand'],mimeType:'image/png',size:'8',version:'1',capabilities:{canDownload:true}},outside:{id:'outside',parents:['root']},shortcut:{id:'shortcut',parents:['brand'],mimeType:DRIVE_SHORTCUT,shortcutDetails:{targetId:'outside'}},allowed:{id:'allowed',parents:['brand'],mimeType:DRIVE_SHORTCUT,shortcutDetails:{targetId:'inside'}},cycle:{id:'cycle',parents:['cycle']}};
const transport=()=>vi.fn(async(url:any)=>new Response(JSON.stringify(nodes[new URL(url).pathname.split('/').pop()!]),{status:200}));
describe('Drive brand boundary',()=>{
 it('permits descendants but never sibling files or cycles',async()=>{const drive=new GoogleDrive('test',transport() as any);expect(await drive.inside('inside','brand')).toBe(true);expect(await drive.inside('outside','brand')).toBe(false);expect(await drive.inside('cycle','brand')).toBe(false)});
 it('requires both shortcut and target in the root',async()=>{const drive=new GoogleDrive('test',transport() as any);await expect(drive.scoped('shortcut','brand')).rejects.toMatchObject({code:'shortcut_outside_brand_folder'});expect((await drive.scoped('allowed','brand')).file.id).toBe('inside');});
 it('rejects arbitrary URL/file injection and uses only read-only transport',async()=>{const fetcher=transport();const drive=new GoogleDrive('test',fetcher as any);await expect(drive.file('https://evil.example/token')).rejects.toBeInstanceOf(DriveError);await drive.file('inside');const [url,options]=fetcher.mock.calls[0];expect(new URL(url).origin).toBe('https://www.googleapis.com');expect(options).not.toHaveProperty('method');expect(options.redirect).toBe('error')});
 it('rejects a mutable file changing during snapshot download',async()=>{let reads=0;const drive=new GoogleDrive('test',vi.fn(async(url:any)=>{const u=new URL(url);if(u.searchParams.get('alt')==='media')return new Response(new Uint8Array(8));return new Response(JSON.stringify({...nodes.inside,version:++reads===1?'1':'2'}));}) as any);await expect(drive.download(await drive.file('inside'))).rejects.toMatchObject({code:'source_changed'});});
 it('verifies actual bytes rather than trusting the supplied filename',()=>{expect(()=>verifySnapshot(new TextEncoder().encode('<script>'),'image/jpeg')).toThrow();expect(()=>verifySnapshot(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png')).not.toThrow()});
});

describe('bounded Drive loading',()=>{
 it('reuses list metadata for all 50 scoped direct children (2 requests, formerly 52)',async()=>{
  const files=Array.from({length:50},(_,i)=>({...nodes.inside,id:`file${i}`,parents:['brand']}));
  const fetcher=vi.fn(async(url:any)=>new Response(JSON.stringify(new URL(url).pathname.endsWith('/files')?{files}:nodes.brand)));
  const drive=new GoogleDrive('test',fetcher as any);await drive.scoped('brand','brand');const page=await drive.list('brand');
  for(const file of page.files)await drive.scoped(file.id,'brand');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('bounds retries and aggregate deadlines without changing permission failures',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{status:503}));const drive=new GoogleDrive('test',fetcher as any);
  await expect(drive.file('inside')).rejects.toMatchObject({code:'drive_unavailable'});expect(fetcher).toHaveBeenCalledTimes(2);
  const expired=vi.fn();await expect(new GoogleDrive('test',expired as any,Date.now()-1).file('inside')).rejects.toMatchObject({code:'drive_unavailable'});expect(expired).not.toHaveBeenCalled();
  const forbidden=vi.fn(async()=>new Response('{}',{status:403}));await expect(new GoogleDrive('test',forbidden as any).file('inside')).rejects.toMatchObject({code:'drive_permission_required'});expect(forbidden).toHaveBeenCalledTimes(1);
 });
 it('proxies only small authenticated Google thumbnails, never original files',async()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10]);const file={...nodes.inside,size:'10000000'};
  const fetcher=vi.fn(async(url:any)=>{const u=new URL(url);if(u.hostname==='lh3.googleusercontent.com')return new Response(png,{headers:{'content-type':'image/png'}});return new Response(JSON.stringify(u.searchParams.get('fields')?.startsWith('thumbnailLink')?{...file,thumbnailLink:'https://lh3.googleusercontent.com/example=s220'}:file));});
  const result=await new GoogleDrive('test',fetcher as any).thumbnail(file);expect(result.bytes.byteLength).toBe(8);expect(result.mime).toBe('image/png');expect(fetcher.mock.calls.some(([url])=>new URL(url).searchParams.get('alt')==='media')).toBe(false);
  const thumb=fetcher.mock.calls.find(([url])=>new URL(url).hostname==='lh3.googleusercontent.com');expect(thumb?.[1]).toMatchObject({redirect:'error',headers:{Authorization:'Bearer test'}});
 });
 it('does not follow untrusted thumbnail URLs or oversized data',async()=>{
  for(const link of ['https://evil.example/steal','https://googleusercontent.com.evil.example/steal','http://lh3.googleusercontent.com/a']){
   const fetcher=vi.fn(async()=>new Response(JSON.stringify({...nodes.inside,thumbnailLink:link})));await expect(new GoogleDrive('test',fetcher as any).thumbnail(nodes.inside)).rejects.toMatchObject({code:'thumbnail_unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher=vi.fn(async(url:any)=>new URL(url).hostname==='lh3.googleusercontent.com'?new Response(new Uint8Array(1048577),{headers:{'content-type':'image/png'}}):new Response(JSON.stringify({...nodes.inside,thumbnailLink:'https://lh3.googleusercontent.com/a'})));
  await expect(new GoogleDrive('test',fetcher as any).thumbnail(nodes.inside)).rejects.toMatchObject({code:'thumbnail_unavailable'});
 });
});
