// Scoped real-provider continuity/recovery QA. Synthetic media only; no physical-device PASS.
import fs from "node:fs";
import { interviewerProfile } from "../../supabase/functions/recruitment-realtime/voice.ts";
import { chromium, expect } from "@playwright/test";
const fixture = process.env.FEEDX_RECRUITMENT_QA_DIR;
if (!fixture) throw Error("A private synthetic fixture directory is required.");
const origin = process.env.FEEDX_RECRUITMENT_QA_ORIGIN || "https://fnb-system-staging.vercel.app";
if (!["http://localhost:5173", "https://fnb-system-staging.vercel.app"].includes(origin))
  throw Error("Only local/Staging QA is permitted.");
const token = fs.readFileSync(`${fixture}/invitation.txt`, "utf8").trim();
const context = await chromium.launchPersistentContext(`${fixture}/browser`, {
  viewport: {width:390,height:844}, permissions:["camera","microphone"], headless:true,
  args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"],
});
await context.exposeBinding("qaEvent", (_, event) => fs.appendFileSync(`${fixture}/timeline.jsonl`, JSON.stringify(event)+"\n"));
const audition = process.env.FEEDX_RECRUITMENT_QA_VOICE || null;
if (audition && !["marin","cedar","sage"].includes(audition)) throw Error("Unknown built-in audition voice.");
await context.exposeBinding("qaAudio", (_, base64) => fs.writeFileSync(`${fixture}/voice-${audition}.webm`, Buffer.from(base64,"base64")));
await context.addInitScript(({audition,profile}) => {
  const original = RTCPeerConnection.prototype.createDataChannel;
  window.qaChannels = [];
  window.qaEvents = [];
  RTCPeerConnection.prototype.createDataChannel = function(...args) {
    const channel=original.apply(this,args), send=channel.send.bind(channel);
    window.qaChannels.push(channel);
    const log=(direction,raw)=>{
      try {
        const e=JSON.parse(raw);
        if (["session.created","session.updated","response.output_audio.delta","rate_limits.updated"].includes(e.type)) return;
        const record={at:Date.now(),direction,...e};
        window.qaEvents.push(record); window.qaEvent(record);
      } catch {}
    };
    channel.send=raw=>{
      const event=JSON.parse(raw);
      if (audition && event.type === "response.create" && !channel.auditioned) {
        channel.auditioned=true;
        send(JSON.stringify({type:"session.update",session:{type:"realtime",audio:{output:{voice:audition}}}}));
        event.response.instructions=profile+" Say exactly: Hi, welcome to your FeedX interview. We will have a short chat about working with our restaurant team. Take your time, there is no rush. Can you tell me about a busy shift you have worked?";
        raw=JSON.stringify(event);
      }
      log("send",raw); return send(raw);
    };
    channel.addEventListener("message", e=>{
      log("receive",e.data);
      if (audition && JSON.parse(e.data).type === "output_audio_buffer.stopped") window.qaRecorder?.stop();
    });
    if (audition) this.addEventListener("track", e=>{
      const recorder=new MediaRecorder(e.streams[0],{mimeType:"audio/webm"}), chunks=[];
      window.qaRecorder=recorder;
      recorder.ondataavailable=e=>chunks.push(e.data);
      recorder.onstop=async()=>{
        const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
        let text=""; for (let i=0;i<bytes.length;i++) text+=String.fromCharCode(bytes[i]);
        await window.qaAudio(btoa(text));
      };
      recorder.start();
    },{once:true});
    return channel;
  };
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await get(constraints);
    const ctx=new AudioContext(), destination=ctx.createMediaStreamDestination();
    const oscillator=ctx.createOscillator(), gain=ctx.createGain();
    gain.gain.value=0.000001; oscillator.connect(gain).connect(destination); oscillator.start();
    window.qaInput={ctx,destination};
    stream.getAudioTracks().forEach(track=>{stream.removeTrack(track);track.stop();});
    stream.addTrack(destination.stream.getAudioTracks()[0]);
    return stream;
  };
  window.qaSpeak=async base64=>{
    const {ctx,destination}=window.qaInput;
    await ctx.resume();
    const data=Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
    const buffer=await ctx.decodeAudioData(data.buffer), source=ctx.createBufferSource();
    source.buffer=buffer; source.connect(destination); source.start();
    return buffer.duration;
  };
},{audition,profile:interviewerProfile.instructions});
const page=await context.newPage(), errors=[];
page.on("pageerror", e=>errors.push(e.message));
const speak=async part=>{
  const seconds=await page.evaluate(bytes=>window.qaSpeak(bytes),fs.readFileSync(`${fixture}/${part}.wav`).toString("base64"));
  await page.waitForTimeout(seconds*1000);
};
const received = async type => page.evaluate(type=>window.qaEvents.filter(e=>e.direction==="receive"&&e.type===type).length,type);
const waitCount = async (type,count) => expect.poll(()=>received(type),{timeout:45000}).toBeGreaterThan(count);
try {
  await page.goto(`${origin}/i/${token}`);
  await expect(page.locator("main h1")).not.toHaveText("Preparing interview…");
  const welcome=page.getByRole("button",{name:"Continue",exact:true});
  if (await welcome.isVisible()) {
    await welcome.click(); await welcome.click();
    await page.getByRole("button",{name:"Confirm details"}).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"I agree and continue"}).click();
    await page.getByRole("button",{name:"Check devices"}).click();
    await expect(page.getByRole("button",{name:"Devices ready"})).toBeEnabled();
    await page.getByRole("button",{name:"Devices ready"}).click();
    await page.getByRole("button",{name:"Start interview",exact:true}).click();
  } else await page.getByRole("button",{name:"Resume with camera and microphone"}).click();
  await expect(page.getByText(/AI connected/)).toBeVisible({timeout:45000});
  await waitCount("output_audio_buffer.stopped",0);
  if (audition) {
    await expect.poll(()=>fs.existsSync(`${fixture}/voice-${audition}.webm`)).toBe(true);
    await page.getByRole("button",{name:"Stop and save partial interview"}).click();
    await expect(page.getByRole("heading",{name:"Interview saved"})).toBeVisible({timeout:180000});
    console.log(`Built-in ${audition} sample captured; voice quality requires listening.`);
    process.exitCode=0;
  } else {
  let stops=await received("output_audio_buffer.stopped");
  await speak("experience"); await waitCount("output_audio_buffer.stopped",stops);
  stops=await received("output_audio_buffer.stopped");
  await speak("thinking");
  const before=await received("response.created");
  await page.waitForTimeout(3000);
  expect(await received("response.created")).toBe(before);
  await speak("continue"); await waitCount("output_audio_buffer.stopped",stops);
  console.log("Natural thinking pause: no extra response; completed answer received one reply.");
  // Barge-in during the next AI question.
  const playback=await received("output_audio_buffer.started");
  await speak("experience");
  await waitCount("output_audio_buffer.started",playback);
  const speech=await received("input_audio_buffer.speech_started");
  await speak("interrupt"); await waitCount("input_audio_buffer.speech_started",speech);
  await page.waitForTimeout(12000);
  await page.reload();
  await expect(page.getByRole("button",{name:"Resume with camera and microphone"})).toBeVisible();
  await page.getByRole("button",{name:"Resume with camera and microphone"}).click();
  await expect(page.getByText(/AI connected/)).toBeVisible({timeout:45000});
  console.log("Immediate refresh resumed with fresh media/provider; no 45-second wait.");
  const duplicate=await context.newPage();
  await duplicate.goto(`${origin}/i/${token}`);
  await duplicate.getByRole("button",{name:"Resume with camera and microphone"}).click();
  await expect(duplicate.getByText(/already open/)).toBeVisible();
  await duplicate.close();
  await page.evaluate(()=>{
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("heading",{name:"Interview interrupted"})).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(()=>window.qaChannels.every(c=>c.readyState==="closed"))).toBe(true);
  await page.evaluate(()=>{
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.screenshot({path:`${fixture}/foreground-recovery.png`});
  await page.getByRole("button",{name:"Resume with camera and microphone"}).click();
  await expect(page.getByText(/AI connected/)).toBeVisible({timeout:45000});
  console.log("Background signal closed transport; explicit foreground continuation reconnected.");
  await page.waitForTimeout(12000);
  await page.getByRole("button",{name:"Reconnect AI",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.qaChannels.filter(c=>c.readyState==="open").length),{timeout:45000}).toBe(1);
  await expect(page.getByText(/AI connected/)).toBeVisible({timeout:45000});
  await page.waitForTimeout(18000);
  await page.getByRole("button",{name:"Stop and save partial interview"}).click();
  await expect(page.getByRole("heading",{name:"Interview saved"})).toBeVisible({timeout:180000});
  await page.screenshot({path:`${fixture}/saved.png`});
  expect(errors).toEqual([]);
  console.log("Same attempt saved; recording manifest and response trace require DB verification.");
  }
} catch(error) {
  console.log(await page.locator("main").innerText()); throw error;
} finally {await context.close();}
