import {MetaError} from './metaGraph.ts';
// Bounded ISO-BMFF metadata inspection; provider decoding/processing is still required.
export function verifyFacebookVideo(bytes:Uint8Array,format:string){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let visited=0;
 const fail=():never=>{throw new MetaError('facebook_video_metadata_unsupported');};
 const text=(offset:number)=>new TextDecoder().decode(bytes.slice(offset,offset+4));
 function boxes(start:number,end:number){
  const result:{type:string;start:number;end:number}[]=[];
  while(start<end){if(++visited>10000||start+8>end)fail();let size=view.getUint32(start),header=8;
   if(size===1){if(start+16>end)fail();const big=view.getBigUint64(start+8);if(big>BigInt(bytes.length))fail();size=Number(big);header=16;}else if(size===0)size=end-start;
   if(size<header||start+size>end)fail();result.push({type:text(start+4),start:start+header,end:start+size});start+=size;
  }return result;
 }
 function child(list:ReturnType<typeof boxes>,type:string){const found=list.find(b=>b.type===type);if(!found)fail();return found!;}
 const movie=child(boxes(0,bytes.length),'moov');
 for(const track of boxes(movie.start,movie.end).filter(b=>b.type==='trak')){
  const children=boxes(track.start,track.end),media=child(children,'mdia'),mdia=boxes(media.start,media.end),handler=child(mdia,'hdlr');
  if(handler.end-handler.start<12)fail();if(text(handler.start+8)!=='vide')continue;
  const head=child(children,'tkhd'),offset=bytes[head.start]===1?12:bytes[head.start]===0?0:fail();
  if(head.end-head.start<84+offset)fail();let width=view.getUint32(head.start+76+offset)/65536,height=view.getUint32(head.start+80+offset)/65536;
  const a=view.getInt32(head.start+40+offset),b=view.getInt32(head.start+44+offset),c=view.getInt32(head.start+52+offset),d=view.getInt32(head.start+56+offset);
  if(a===0&&d===0&&Math.abs(b)===65536&&b===-c)[width,height]=[height,width];else if(b!==0||c!==0||Math.abs(a)!==65536||a!==d)fail();
  const timing=child(mdia,'mdhd'),version=bytes[timing.start];if(version!==0&&version!==1)fail();
  if(timing.end-timing.start<(version===1?32:20))fail();const scale=view.getUint32(timing.start+(version===1?20:12)),duration=version===1?Number(view.getBigUint64(timing.start+24)):view.getUint32(timing.start+16);
  const seconds=duration/scale;if(!Number.isFinite(seconds)||seconds<=0||!width||!height)fail();
  const minf=child(mdia,'minf'),table=child(boxes(minf.start,minf.end),'stbl'),stbl=boxes(table.start,table.end),description=child(stbl,'stsd');
  if(description.end-description.start<8)fail();const entries=boxes(description.start+8,description.end);if(entries.length!==1||entries[0].type!=='avc1')fail();
  if(format==='reel'){
   const sample=child(stbl,'stts');if(sample.end-sample.start<8)fail();const n=view.getUint32(sample.start+4);if(n>10000||sample.start+8+n*8!==sample.end)fail();let count=0,ticks=0;
   for(let i=0;i<n;i++){const at=sample.start+8+i*8,num=view.getUint32(at),delta=view.getUint32(at+4);count+=num;ticks+=num*delta;}
   const fps=count*scale/ticks;
   if(width<540||height<960||Math.abs(width/height-9/16)>.005||seconds<4||seconds>60||!Number.isFinite(fps)||fps<23||fps>60)throw new MetaError('facebook_reel_dimensions_duration_or_framerate_unsupported');
  }
  return {width,height,duration:seconds};
 }return fail();
}
