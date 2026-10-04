// Technical fault-injection regression only. It does not attest physical OS behavior.
import fs from "node:fs";
import { chromium, expect } from "@playwright/test";
const dir=process.env.FEEDX_RECRUITMENT_QA_DIR;
if (!dir) throw Error("Private synthetic fixture directory required.");
const origin="https://fnb-system-staging.vercel.app";
const token=fs.readFileSync(`${dir}/invitation.txt`,"utf8").trim();
const context=await chromium.launchPersistentContext(`${dir}/browser`,{headless:true,viewport:{width:390,height:844},permissions:["camera","microphone"],args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream","--autoplay-policy=no-user-gesture-required"]});
await context.addInitScript(()=>{
  const Peer=window.RTCPeerConnection;
  window.qaPeers=[];
  window.RTCPeerConnection=class extends Peer { constructor(...args){super(...args);window.qaPeers.push(this);} };
  window.qaHidden=false;
  Object.defineProperty(document,"hidden",{configurable:true,get:()=>window.qaHidden});
  const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=constraints=> window.qaHangMedia ? new Promise(()=>{}) : window.qaRejectMedia ? Promise.reject(new DOMException("Native device unavailable", "NotReadableError")) : acquire(constraints);
  const resume=AudioContext.prototype.resume,close=AudioContext.prototype.close;
  AudioContext.prototype.resume=function(...args){return window.qaHangAudio ? new Promise(()=>{}) : resume.apply(this,args);};
  AudioContext.prototype.close=function(...args){const result=close.apply(this,args);return window.qaHangClose ? new Promise(()=>{}) : result;};
});
const page=await context.newPage(),held=[];
let blockUploads=false;
page.on("response",response=>{
  const path=new URL(response.url()).pathname;
  if (/recruitment_recovery|recruitment-realtime/.test(path)) fs.appendFileSync(`${dir}/requests.jsonl`,JSON.stringify({at:Date.now(),path,status:response.status()})+"\n");
});
await page.route(/\/storage\/v1\/object\/upload\/sign\//,route=>blockUploads ? new Promise(resolve=>held.push({route,resolve})) : route.continue());
const resume=()=>page.getByRole("button",{name:"Continue interview",exact:true});
const connected=()=>expect(page.getByText(/Interview in progress/)).toBeVisible({timeout:45000});
try {
  await page.goto(`${origin}/i/${token}`);
  await expect.poll(async()=>await page.getByRole("button",{name:"Continue",exact:true}).count() || await resume().count() || await page.getByRole("button",{name:"Start interview",exact:true}).count(),{timeout:30000}).toBeTruthy();
  if(await page.getByRole("button",{name:"Continue",exact:true}).count()) {
    await page.getByRole("button",{name:"Continue",exact:true}).click();
    await page.getByRole("button",{name:"Continue",exact:true}).click();
    await page.getByRole("button",{name:"Confirm details"}).click();
    await page.getByRole("checkbox").check();await page.getByRole("button",{name:"I agree and continue"}).click();
    await page.getByRole("button",{name:"Check devices"}).click();
    await expect(page.getByRole("button",{name:"Devices ready"})).toBeEnabled({timeout:20000});
    await page.getByRole("button",{name:"Devices ready"}).click();
  }
  if(await resume().count()) await resume().click();
  else await page.getByRole("button",{name:"Start interview",exact:true}).click();
  await connected();
  blockUploads=true;
  await page.evaluate(()=>{window.qaHangClose=true;window.qaHidden=true;document.dispatchEvent(new Event("visibilitychange"));});
  await expect(page.getByRole("heading",{name:"Interview interrupted"})).toBeVisible();
  await page.evaluate(()=>{window.qaHidden=false;document.dispatchEvent(new Event("visibilitychange"));window.qaHangMedia=true;});
  await resume().click();
  await expect(page.getByRole("alert")).toContainText(/Camera and microphone timed out/,{timeout:35000});
  await expect(resume()).toBeEnabled();
  await page.screenshot({path:`${dir}/foreground-timeout.png`});
  await page.evaluate(()=>{window.qaHangMedia=false;window.qaRejectMedia=true;});
  await resume().click();
  await expect(page.getByRole("alert")).toContainText(/device is unavailable/);
  await expect(page.getByRole("alert")).not.toContainText(/Allow access|access was denied/);
  await page.evaluate(()=>{window.qaRejectMedia=false;});
  await resume().click();await connected();
  console.log("Foreground: stale close/uploads + hung native getUserMedia => visible retry => fresh generation connected.");
  // Cold refresh must discard all JS refs; then a separate acquisition fault is retryable.
  await page.reload();await expect(resume()).toBeEnabled({timeout:20000});
  await page.evaluate(()=>{window.qaHangMedia=true;});
  await resume().click();
  await expect(page.getByRole("alert")).toContainText(/Camera and microphone timed out/,{timeout:35000});
  await expect(resume()).toBeEnabled();
  await page.evaluate(()=>{window.qaHangMedia=false;});
  await resume().click();await connected();
  await page.screenshot({path:`${dir}/cold-refresh-resumed.png`});
  console.log("Cold refresh: durable bootstrap, bounded fresh acquisition failure, then effective retry connected.");
  await expect(page.getByRole("button",{name:"Reconnect AI"})).toHaveCount(0);
  const priorPeerCount=await page.evaluate(()=>window.qaPeers.length);
  await page.evaluate(()=>{const peer=window.qaPeers.at(-1);peer.close();peer.dispatchEvent(new Event("connectionstatechange"));});
  await expect(page.getByRole("heading",{name:"Interview interrupted"})).toBeVisible();
  await expect(page.getByText("● Recording",{exact:true})).toHaveCount(0);
  await expect(resume()).toBeEnabled();
  await resume().click();await connected();
  await expect.poll(()=>page.evaluate(()=>window.qaPeers.length)).toBe(priorPeerCount+1);
  await expect(page.getByRole("button",{name:"Reconnect AI"})).toHaveCount(0);
  console.log("Dead transport: capture stopped, one Continue action, fresh native peer and recording generation.");
  blockUploads=false;
  for(const item of held.splice(0)){await item.route.abort();item.resolve();}
  await page.getByRole("button",{name:"Stop and save partial interview"}).click();
  await expect.poll(async()=>{
    if(await page.getByRole("heading",{name:"Interview saved",exact:true}).count()) return true;
    const retry=page.getByRole("button",{name:"Retry saving evidence",exact:true});
    if(await retry.count() && await retry.isEnabled()) await retry.click();
    return false;
  },{timeout:180000,intervals:[1000,5000,10000]}).toBe(true);
  await page.screenshot({path:`${dir}/saved.png`});
  console.log("Same attempt saved with truthful interruption evidence; inspect server transitions/manifest.");
} catch(error){console.log(await page.locator("main").innerText());throw error;}
finally {for(const item of held){await item.route.abort().catch(()=>{});item.resolve();}await context.close();}
