// Observe existing SDK tracks. No capture, recording, destination connection or track ownership.
export function createVoiceAudioMeter({emit, Context=globalThis.AudioContext||globalThis.webkitAudioContext, Stream=globalThis.MediaStream, hidden=()=>document.hidden, reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches, phase=()=> 'idle'}) {
 let context, timer, sources=[], tracks=[], disposed=false;
 const zeros=()=>emit({level:0,bands:Array(20).fill(0),source:'none'});
 try {if(Context)context=new Context();}catch{ /* Optional visual telemetry must not block Voice. */ }
 const bands=new Float32Array(20);
 let peer;
 function attach() {
  const next=[peer?.getSenders?.().find(s=>s.track?.kind==='audio')?.track,peer?.getReceivers?.().find(s=>s.track?.kind==='audio')?.track];
  if(next.every((track,i)=>track===tracks[i]))return;
  sources.forEach(s=>s?.node.disconnect());sources=[];tracks=next;
  if(!context||!Stream)return;
  sources=next.map(track=>{
   if(!track||track.readyState==='ended')return null;
   try{const node=context.createMediaStreamSource(new Stream([track])),analyser=context.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.55;node.connect(analyser);return {node,analyser,data:new Uint8Array(analyser.frequencyBinCount)};}catch{return null;}
  });
 }
 function sample() {
  clearTimeout(timer);
  if(disposed||hidden()){zeros();return;}
  attach();
  const speaking=phase()==='speaking', listening=['listening','interrupted'].includes(phase());
  const source=(speaking||listening)&&sources[speaking?1:0];
  let peak=0;
  if(source&&context?.state==='running'){
   source.analyser.getByteFrequencyData(source.data);
   for(let i=0;i<20;i++){
    // Log-spaced speech bands; subtract the analyser floor rather than adding synthetic motion.
    const from=Math.floor(Math.pow(i/20,1.7)*(source.data.length-1)),to=Math.max(from+1,Math.floor(Math.pow((i+1)/20,1.7)*source.data.length));
    let energy=0;for(let k=from;k<to;k++)energy=Math.max(energy,source.data[k]);
    const value=Math.max(0,(energy-28)/227);bands[i]=value>.005?value:0;peak=Math.max(peak,bands[i]);
   }
  }else bands.fill(0);
  emit({level:peak,bands:Array.from(bands),source:source?(speaking?'output':'microphone'):'none'});
  timer=setTimeout(sample,reduced()?120:50);
 }
 return {
  async resume(connection){if(disposed)return;peer=connection||peer;try{await context?.resume();}catch{}sample();},
  pause(){clearTimeout(timer);zeros();void context?.suspend().catch(()=>{});},
  close(){disposed=true;clearTimeout(timer);sources.forEach(s=>s?.node.disconnect());sources=[];tracks=[];zeros();void context?.close().catch(()=>{});},
 };
}
