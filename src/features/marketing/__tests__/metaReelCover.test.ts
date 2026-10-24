import {it,expect,vi} from 'vitest';
import {validateReelCover,publishingAssetIds,reelCoverParameters,verifyCoverFrame} from '../../../../supabase/functions/_shared/metaReelCover.ts';
import {advanceMetaPublish,verifyMetaMedia} from '../../../../supabase/functions/_shared/metaPublishing.ts';
const video='00000000-0000-4000-8000-000000000001',image='00000000-0000-4000-8000-000000000002';
const reel={channel:'instagram' as const,format:'reel',caption:'Fixture',asset_ids:[video]};
it('keeps cover media separate from primary Reel media and deduplicates pinned references',()=>{
 const v={...reel,reel_cover:{mode:'image' as const,video_asset_id:video,asset_id:image}};expect(publishingAssetIds(v)).toEqual([video,image]);expect(v.asset_ids).toEqual([video]);expect(publishingAssetIds(reel)).toEqual([video]);
});
it('supports an explicit zero frame offset and custom image, never both provider parameters',()=>{
 expect(reelCoverParameters({...reel,reel_cover:{mode:'frame',video_asset_id:video,offset_ms:0}})).toEqual({thumb_offset:0});expect(reelCoverParameters({...reel,reel_cover:{mode:'image',video_asset_id:video,asset_id:image}},'https://private.example/cover')).toEqual({cover_url:'https://private.example/cover'});
});
it.each([
 {mode:'image',video_asset_id:video,asset_id:image,offset_ms:1},
 {mode:'frame',video_asset_id:video,offset_ms:-1},
 {mode:'frame',video_asset_id:video,offset_ms:1.2},
 {mode:'frame',video_asset_id:image,offset_ms:1},
 {mode:'image',video_asset_id:video,asset_id:video},
 {mode:'image',video_asset_id:video,asset_id:'not-an-id'},
 {mode:'automatic',asset_id:image},null
])('fails closed for malformed or mismatched cover settings %#',cover=>{expect(()=>validateReelCover({...reel,reel_cover:cover} as any)).toThrow();});
it('does not expose unsupported Facebook controls or attach covers to other formats',()=>{
 expect(()=>validateReelCover({...reel,channel:'facebook',reel_cover:{mode:'frame',video_asset_id:video,offset_ms:0}})).toThrow();expect(()=>validateReelCover({...reel,format:'carousel',reel_cover:{mode:'automatic'}})).toThrow();expect(validateReelCover({...reel,channel:'facebook',reel_cover:{mode:'automatic'}})).toEqual({mode:'automatic'});
});
const jpeg=(w:number,h:number)=>new Uint8Array([255,216,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,17,0,2,17,0,3,17,0,255,217]);
it('validates custom-cover bytes without relaxing ordinary Instagram image constraints',()=>{
 expect(()=>verifyMetaMedia(jpeg(1080,1920),'image/jpeg','instagram','reel_cover')).not.toThrow();expect(()=>verifyMetaMedia(jpeg(1080,1080),'image/jpeg','instagram','reel_cover')).toThrow();expect(()=>verifyMetaMedia(jpeg(1080,1920),'image/jpeg','instagram','image')).toThrow();expect(()=>verifyMetaMedia(jpeg(1080,1920),'image/jpeg','facebook','reel_cover')).toThrow();
});
function box(type:string,...parts:Uint8Array[]){const d=new Uint8Array(8+parts.reduce((n,p)=>n+p.length,0));new DataView(d.buffer).setUint32(0,d.length);d.set(new TextEncoder().encode(type),4);let at=8;for(const p of parts){d.set(p,at);at+=p.length;}return d;}
function metadataVideo(){const h=new Uint8Array(84),v=new DataView(h.buffer);v.setInt32(40,65536);v.setInt32(56,65536);v.setUint32(76,540*65536);v.setUint32(80,960*65536);const t=new Uint8Array(24),tv=new DataView(t.buffer);tv.setUint32(12,1000);tv.setUint32(16,5000);const handler=new Uint8Array(12);handler.set(new TextEncoder().encode('vide'),8);const desc=new Uint8Array(8);new DataView(desc.buffer).setUint32(4,1);return box('moov',box('trak',box('tkhd',h),box('mdia',box('hdlr',handler),box('mdhd',t),box('minf',box('stbl',box('stsd',desc,box('avc1')))))));}
it('checks the offset against immutable video duration before any provider submission',()=>{
 expect(()=>verifyCoverFrame({...reel,reel_cover:{mode:'frame',video_asset_id:video,offset_ms:4999}},metadataVideo())).not.toThrow();expect(()=>verifyCoverFrame({...reel,reel_cover:{mode:'frame',video_asset_id:video,offset_ms:5000}},metadataVideo())).toThrow('reel_cover_frame_outside_video');
});
it('submits the cover only at container creation, preserving checkpoint recovery and publication evidence',async()=>{
 let state:any={};const request=vi.fn().mockResolvedValueOnce({id:'900'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'901'}),guard=vi.fn();
 const input={graph:{request} as any,accountId:'111',token:'fixture',variant:{...reel,reel_cover:{mode:'image' as const,video_asset_id:video,asset_id:image}},mediaUrls:['https://private.example/video'],coverUrl:'https://private.example/cover',guard,checkpoint:async(s:any)=>{state=structuredClone(s)}};
 await advanceMetaPublish({...input,state});expect(request.mock.calls[0][2]).toMatchObject({media_type:'REELS',cover_url:input.coverUrl});expect(state).not.toHaveProperty('coverUrl');expect(JSON.stringify(state)).not.toContain('https://');
 expect(await advanceMetaPublish({...input,state})).toEqual({outcome:'published',postId:'901'});expect(request.mock.calls.filter(c=>c[3]==='POST')).toHaveLength(2);expect(request.mock.calls[2][2]).toEqual({creation_id:'900'});
 request.mockClear();expect((await advanceMetaPublish({...input,state:{pending:'container'}})).outcome).toBe('uncertain');expect(request).not.toHaveBeenCalled();
});
