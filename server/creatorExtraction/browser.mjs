import {boundedTiming} from './diagnostics.mjs';
import {boundedGet} from './network.mjs';
import {allowedResource,platformUrl} from './urls.mjs';
// No user browser/profile, stealth, CAPTCHA handling or authentication is used.
export async function renderPublic(url,platform,budget,{executablePath,urlResolver=platformUrl,diagnostics}={}){
 let stage='load',started=performance.now();
 const nextStage=next=>{if(diagnostics){diagnostics[stage+'_ms']=boundedTiming(started);diagnostics.stage=next||stage;}stage=next;started=performance.now();};
 if(diagnostics)diagnostics.stage=stage;
 try{
 if(Date.now()>=budget.deadline)throw new Error('inspection_limit');
 const {chromium:playwright}=await import('playwright-core');
 const {default:chromium}=await import('@sparticuz/chromium');
 if(Date.now()>=budget.deadline)throw new Error('inspection_limit');
 // Metadata extraction needs DOM/JavaScript, not software-rendered WebGL.
 chromium.setGraphicsMode=false;
 nextStage('launch');
 const resolvedExecutable=executablePath||await chromium.executablePath();
 if(Date.now()>=budget.deadline)throw new Error('inspection_limit');
 const browser=await playwright.launch({executablePath:resolvedExecutable,args:[...(executablePath?[]:chromium.args),'--dns-prefetch-disable','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],headless:true,timeout:Math.min(12000,budget.deadline-Date.now())});
 nextStage('render');
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
  if(Date.now()>=budget.deadline)throw new Error('inspection_limit');
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:Math.min(18000,Math.max(1,budget.deadline-Date.now()))});
  const remaining=budget.deadline-Date.now();
  if(remaining>0)await page.waitForFunction(()=>document.querySelector('article time,#detail-title,#SIGI_STATE,script[type="application/ld+json"],meta[property="og:description"]'),{},{timeout:Math.min(4000,remaining)}).catch(()=>{});
  const html=await page.content();return {html:html.slice(0,5000000),url:page.url(),status:mainStatus,method:'public_browser'};
 }catch(error){if(diagnostics)diagnostics.failed_stage=stage;throw error;}
 finally{nextStage('cleanup');await browser.close()}
 }catch(error){if(diagnostics)diagnostics.failed_stage||=stage;throw error;}
 finally{nextStage(null)}
}
