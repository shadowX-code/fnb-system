import {it,expect} from 'vitest';
import {verifyFacebookVideo} from '../../../../supabase/functions/_shared/metaVideoMedia.ts';
function box(type:string,...parts:Uint8Array[]){const size=8+parts.reduce((n,p)=>n+p.length,0),data=new Uint8Array(size);new DataView(data.buffer).setUint32(0,size);data.set(new TextEncoder().encode(type),4);let at=8;for(const part of parts){data.set(part,at);at+=part.length;}return data;}
// Metadata-only fixtures: provider decoding is deliberately not claimed by this test.
function fixture(width=540,height=960,duration=5,fps=30,codec='avc1'){
 const head=new Uint8Array(84),h=new DataView(head.buffer);h.setInt32(40,65536);h.setInt32(56,65536);h.setUint32(76,width*65536);h.setUint32(80,height*65536);
 const mdhd=new Uint8Array(24),m=new DataView(mdhd.buffer);m.setUint32(12,30000);m.setUint32(16,duration*30000);
 const handler=new Uint8Array(12);handler.set(new TextEncoder().encode('vide'),8);
 const sample=new Uint8Array(16),v=new DataView(sample.buffer);v.setUint32(4,1);v.setUint32(8,duration*fps);v.setUint32(12,30000/fps);
 const desc=new Uint8Array(8);new DataView(desc.buffer).setUint32(4,1);
 return box('moov',box('trak',box('tkhd',head),box('mdia',box('mdhd',mdhd),box('hdlr',handler),box('minf',box('stbl',box('stsd',desc,box(codec)),box('stts',sample))))));
}
it('accepts a conservative Reel subset and does not apply Reel aspect/duration to Page Video',()=>{expect(verifyFacebookVideo(fixture(),'reel')).toEqual({width:540,height:960,duration:5});expect(verifyFacebookVideo(fixture(1920,1080,2),'video').duration).toBe(2);});
it.each([[1920,1080,5,30],[540,960,2,30],[540,960,61,30],[540,960,5,15],[270,480,5,30]])('rejects incompatible Reel geometry or timing %j',(...args)=>{expect(()=>verifyFacebookVideo(fixture(...args),'reel')).toThrow('facebook_reel_dimensions_duration_or_framerate_unsupported');});
it('rejects unsupported codec, missing movie and malformed/unbounded boxes',()=>{expect(()=>verifyFacebookVideo(fixture(540,960,5,30,'hvc1'),'video')).toThrow();expect(()=>verifyFacebookVideo(new Uint8Array([0,0,0,4,0,0,0,0]),'video')).toThrow();const tooBig=fixture();new DataView(tooBig.buffer).setUint32(0,0xffffffff);expect(()=>verifyFacebookVideo(tooBig,'video')).toThrow();});
