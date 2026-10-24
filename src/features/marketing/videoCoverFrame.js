// Preview only: persist the provider frame offset, never a duplicate image snapshot.
export async function videoCoverFrame(url,offsetMs,signal){
 const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.preload='auto';
 const wait=event=>new Promise((resolve,reject)=>{
  const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error(signal?.aborted?'Preview cancelled.':'Video frame preview unavailable.'));},timer=setTimeout(fail,8000);
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',fail);signal?.removeEventListener('abort',fail);};
  video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',fail,{once:true});if(signal?.aborted)fail();
 });
 try{
  const loaded=wait('loadedmetadata');video.src=url;video.load();await loaded;
  const metadata={width:video.videoWidth,height:video.videoHeight,duration:video.duration};
  if(!video.videoWidth||!video.videoHeight)throw new Error('Video frame preview unavailable.');
  if(!Number.isSafeInteger(offsetMs)||offsetMs<0||!Number.isFinite(video.duration)||offsetMs>=video.duration*1000)throw new Error('Choose a frame within the video duration.');
  if(offsetMs>0){const seek=wait('seeked');video.currentTime=offsetMs/1000;await seek;}
  else if(video.readyState<2)await wait('loadeddata');
  signal?.throwIfAborted();const scale=Math.min(1,720/video.videoWidth,1280/video.videoHeight),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('Frame preview is unavailable in this browser.');context.drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Video frame preview unavailable.')),'image/jpeg',.85));
  signal?.throwIfAborted();return {blob,metadata};
 }catch(error){if(signal?.aborted||['Choose a frame within the video duration.','Frame preview is unavailable in this browser.','Video frame preview unavailable.'].includes(error.message))throw error;throw new Error('Video frame preview unavailable. Try another frame or a custom image.');}
 finally{video.removeAttribute('src');video.load();}
}
