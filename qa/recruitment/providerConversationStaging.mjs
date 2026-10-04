// Real OpenAI + Staging evidence, synthetic input only. Not physical mobile certification.
import fs from "node:fs";
import {chromium,expect} from "@playwright/test";
const dir=process.env.FEEDX_RECRUITMENT_QA_DIR;
const origin=process.env.FEEDX_RECRUITMENT_QA_ORIGIN||"https://fnb-system-staging.vercel.app";
if(!dir || !["http://localhost:5173","https://fnb-system-staging.vercel.app"].includes(origin))throw Error("Private Staging fixture required");
const token=fs.readFileSync(`${dir}/invitation.txt`,"utf8").trim();
const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"]});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
await context.addInitScript(()=>{
 window.qaEvents=[];window.qaSends=[];window.qaPeers=[];window.qaHidden=false;
 Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.qaHidden});
 const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=constraints=>{
   const request=acquire(constraints);
   const ctx=new AudioContext();ctx.resume();const dest=ctx.createMediaStreamDestination();const silence=ctx.createOscillator(),gain=ctx.createGain();gain.gain.value=0;silence.connect(gain);gain.connect(dest);silence.start();
   return request.then(stream=>{
     stream.getAudioTracks().forEach(t=>{stream.removeTrack(t);t.stop();});stream.addTrack(dest.stream.getAudioTracks()[0]);
     window.qaInput={ctx,dest};return stream;
   });
 };
 window.qaSpeak=async(url)=>{
   const {ctx,dest}=window.qaInput;await ctx.resume();
   const buffer=await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
   const source=ctx.createBufferSource();source.buffer=buffer;source.connect(dest);source.start();
 };
 const Peer=RTCPeerConnection;
 window.RTCPeerConnection=class extends Peer{
   constructor(...args){super(...args);window.qaPeers.push(this);}
   createDataChannel(...args){const ch=super.createDataChannel(...args),send=ch.send.bind(ch);
     ch.send=data=>{const e=JSON.parse(data);window.qaSends.push({type:e.type,kind:e.response?.metadata?.feedx_kind});send(data);};
     ch.addEventListener("message",({data})=>{const e=JSON.parse(data);window.qaEvents.push({at:Date.now(),type:e.type,response_id:e.response_id||e.response?.id,item_id:e.item_id,kind:e.response?.metadata?.feedx_kind,status:e.response?.status,transcript:e.transcript,turn_detection:e.session?.audio?.input?.turn_detection});});return ch;
   }
 };
});
const page=await context.newPage();const errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("response",r=>{if(r.url().includes("/functions/v1/recruitment-realtime"))fs.appendFileSync(`${dir}/context-status.jsonl`,JSON.stringify({status:r.status(),action:r.request().postDataJSON()?.action||"secret"})+"\n");});
await page.route("https://qa.feedx.invalid/audio/*",route=>route.fulfill({contentType:"audio/wav",body:fs.readFileSync(`${dir}/${new URL(route.request().url()).pathname.split('/').at(-1)}.wav`)}));
const count=(type)=>page.evaluate(type=>window.qaEvents.filter(e=>e.type===type).length,type);
const connected=()=>expect(page.getByText("Interview in progress",{exact:false})).toBeVisible({timeout:45000});
const resume=()=>page.getByRole("button",{name:"Continue interview",exact:true});
async function speak(name,interrupt=false){
 const before=await count("input_audio_buffer.committed");const responses=await count("response.created");const stopped=await count("output_audio_buffer.stopped");
 await page.evaluate(name=>window.qaSpeak(`https://qa.feedx.invalid/audio/${name}`),name);
 await expect.poll(()=>count("input_audio_buffer.committed"),{timeout:65000}).toBeGreaterThan(before);
 await expect.poll(()=>count("response.created"),{timeout:40000}).toBeGreaterThan(responses);
 await expect.poll(()=>count("output_audio_buffer.stopped"),{timeout:60000}).toBeGreaterThan(stopped);
 if(interrupt)expect(await count("output_audio_buffer.cleared")).toBeGreaterThan(0);
 await connected();
}
try{
 await page.goto(`${origin}/i/${token}`);
 await expect.poll(async()=>await resume().count() || await page.getByRole("button",{name:"Continue",exact:true}).count(),{timeout:20000}).toBeTruthy();
 if(await resume().count())await resume().click();else{
   await page.getByRole("button",{name:"Continue",exact:true}).click();
   await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Check camera and microphone"}).click();
   await expect(page.getByRole("button",{name:"Start interview",exact:true})).toBeEnabled({timeout:20000});await page.getByRole("button",{name:"Start interview",exact:true}).click();
 }
 await connected();
 await expect.poll(()=>count("output_audio_buffer.stopped"),{timeout:40000}).toBeGreaterThan(0);
 const settings=await page.evaluate(()=>window.qaEvents.find(e=>e.turn_detection)?.turn_detection);
 expect(settings?.create_response).toBe(true);expect(settings?.interrupt_response).toBe(true);
 for(const language of ["en","bm","zh"])await speak(language);
 // A real input-audio interruption of a generated reply, not synthetic provider events.
 const committed=await count("input_audio_buffer.committed"),started=await count("output_audio_buffer.started");
 await page.evaluate(()=>window.qaSpeak("https://qa.feedx.invalid/audio/en"));
 await expect.poll(()=>count("input_audio_buffer.committed"),{timeout:40000}).toBeGreaterThan(committed);
 await expect.poll(()=>count("output_audio_buffer.started"),{timeout:40000}).toBeGreaterThan(started);
 await speak("short",true);
 const clientCreates=await page.evaluate(()=>window.qaSends.filter(e=>e.type==="response.create"));
 expect(clientCreates.filter(e=>!e.kind)).toHaveLength(0);expect(clientCreates.filter(e=>e.kind==="entry")).toHaveLength(1);
 // One same-attempt fresh reconstruction after visibility loss and another after cold bootstrap.
 await page.evaluate(()=>{window.qaHidden=true;document.dispatchEvent(new Event("visibilitychange"));});
 await expect(resume()).toBeVisible();await page.evaluate(()=>{window.qaHidden=false;document.dispatchEvent(new Event("visibilitychange"));});await resume().click();await connected();
 await expect.poll(()=>count("output_audio_buffer.stopped"),{timeout:40000}).toBeGreaterThan(0);
 await page.reload();await expect(resume()).toBeEnabled({timeout:20000});await resume().click();await connected();
 await expect.poll(()=>count("output_audio_buffer.stopped"),{timeout:40000}).toBeGreaterThan(0);
 await expect(page.getByRole("button",{name:"Reconnect AI"})).toHaveCount(0);
 fs.writeFileSync(`${dir}/provider-events.json`,JSON.stringify(await page.evaluate(()=>({events:window.qaEvents,sends:window.qaSends})),null,2));
 await page.getByRole("button",{name:"Stop and save partial interview",exact:true}).click();
 await expect.poll(async()=>{if(await page.getByRole("heading",{name:"Interview saved",exact:true}).count())return true;const retry=page.getByRole("button",{name:"Retry saving evidence"});if(await retry.count()&&await retry.isEnabled())await retry.click();return false;},{timeout:180000,intervals:[1000,5000,10000]}).toBe(true);
 expect(errors).toEqual([]);console.log("PASS: provider-native EN/BM/Chinese input, short barge-in, no ordinary client response.create, quiet context, foreground/cold fresh generations and saved partial evidence.");
}catch(e){fs.writeFileSync(`${dir}/failure-events.json`,JSON.stringify(await page.evaluate(()=>({events:window.qaEvents,sends:window.qaSends})),null,2));console.log(await page.locator("main").innerText());throw e;}
finally{await browser.close();}
