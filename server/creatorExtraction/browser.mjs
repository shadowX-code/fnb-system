import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {boundedGet} from './network.mjs';
import {allowedResource,platformUrl} from './urls.mjs';
// No user browser/profile, stealth, CAPTCHA handling or authentication is used.
export async function renderPublic(url,platform,budget,{executablePath,urlResolver=platformUrl}={}){
 const browser=await playwright.launch({executablePath:executablePath||await chromium.executablePath(),args:[...(executablePath?[]:chromium.args),'--dns-prefetch-disable','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],headless:true,timeout:12000});
 try{
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage();let navigations=0,mainStatus=0;
  await context.route('**/*',async route=>{
   const req=route.request();
   if(req.method()!=='GET'||!allowedResource(req.url(),platform)||['image','media','font','websocket'].includes(req.resourceType())||req.isNavigationRequest()&&req.frame()!==page.mainFrame())return route.abort();
   try{
    if(req.isNavigationRequest()){if(++navigations>6)return route.abort();if(urlResolver(req.url()).platform!==platform)return route.abort()}
    const result=await boundedGet(req.url(),platform,budget,false,req.headers()['user-agent']);
    if(req.isNavigationRequest())mainStatus=result.status;
    // Browser cannot perform its own DNS lookup or send cookies/credentials: all traffic is pinned here.
    const headers={};for(const [key,val] of Object.entries(result.headers))if(['content-type','location','content-security-policy','referrer-policy','x-frame-options'].includes(key)&&typeof val==='string')headers[key]=val;
    if(headers.location){const next=new URL(headers.location,req.url());if(!allowedResource(next.href,platform))return route.abort()}
    await route.fulfill({status:result.status,headers,body:result.body});
   }catch{await route.abort().catch(()=>{})}
  });
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:Math.min(18000,Math.max(1,budget.deadline-Date.now()))});
  await page.waitForFunction(()=>document.querySelector('article time,#detail-title,#SIGI_STATE,script[type="application/ld+json"],meta[property="og:description"]'),{},{timeout:4000}).catch(()=>{});
  const html=await page.content();return {html:html.slice(0,5000000),url:page.url(),status:mainStatus,method:'public_browser'};
 }finally{await browser.close()}
}
