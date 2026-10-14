import {chromium} from 'playwright-core';
import {platformUrl} from '../creatorExtraction/urls.mjs';
import {resolvePostUrl,networkBudget} from '../creatorExtraction/network.mjs';
import {extractMetadata} from '../creatorExtraction/extract.mjs';
import {relay} from './transport.mjs';
const LOGIN='https://www.xiaohongshu.com/explore';
export function createReader({store,executablePath,liveApproved=false,persistApproved=false,launch=options=>chromium.launch(options),now=Date.now}){
 let pending=null,busy=false,state='disconnected',lastRead=0;const cache=new Map();
 const status=()=>({status:state,configured:Boolean(executablePath),live_enabled:liveApproved,session_persistence_enabled:persistApproved});
 async function closePending(){const old=pending;pending=null;if(old){clearTimeout(old.timer);await old.browser.close()}}
 async function browserSession(storageState,login=false){
  const browser=await launch({executablePath,headless:true,timeout:12000,args:['--dns-prefetch-disable','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  try{const context=await browser.newContext({storageState,serviceWorkers:'block',acceptDownloads:false});await context.routeWebSocket('**/*',socket=>socket.close());const page=await context.newPage(),budget=networkBudget(login?180000:25000);
   await context.route('**/*',route=>relay(route,budget,login).catch(()=>route.abort().catch(()=>{})));page.on('download',download=>download.cancel());page.on('popup',popup=>popup.close());return {browser,context,page};
  }catch(e){await browser.close();throw e}
 }
 async function blocked(page){const text=await page.locator('body').innerText({timeout:2000}).catch(()=>''),path=new URL(page.url()).pathname;if(/captcha|请完成验证|安全验证|安全限制|访问频繁|请求过于频繁|IP存在风险|300012/i.test(text)||path.startsWith('/404'))return 'blocked';if(path.startsWith('/login'))return 'expired';return null}
 return {status,shutdown:closePending,
  async run(action,url){
   if(action==='status'){if(['disconnected','stored_unverified','connected'].includes(state)){const saved=await store.load();if(saved&&saved.expires_at<=now()){await store.clear();cache.clear();state='expired'}else if(saved&&state==='disconnected')state='stored_unverified'}return status()}if(busy)throw new Error('reader_busy');busy=true;
   try{
    if(action==='disconnect'){await closePending();await store.clear();cache.clear();state='disconnected';return status()}
    if(!liveApproved||!persistApproved||!executablePath)throw new Error('reader_approval_required');
    if(action==='login_start'){
     await closePending();await store.clear();cache.clear();state='awaiting_login';const current=await browserSession(undefined,true);pending=current;current.timer=setTimeout(()=>{if(pending===current){state='expired';closePending().catch(()=>{})}},180000);current.timer.unref?.();
     try{await current.page.goto(LOGIN,{waitUntil:'domcontentloaded',timeout:20000});if(await blocked(current.page)){state='blocked';await store.clear();await closePending();return status()}
      const qr=current.page.locator('.login-container .qrcode-img');await qr.waitFor({state:'visible',timeout:8000});return {...status(),qr_image:'data:image/png;base64,'+(await qr.screenshot({type:'png'})).toString('base64'),expires_in:180};
     }catch{state='unavailable';await closePending();throw new Error('reader_login_unavailable')}
    }
    if(action==='login_check'){
     if(!pending)return status();const current=pending,restriction=await blocked(current.page);if(restriction){state=restriction;await store.clear();await closePending();return status()}
     const identity=await current.page.locator('.main-container .user .link-wrapper .channel').isVisible();const storage=await current.context.storageState();const valid=storage.cookies.some(c=>c.name==='web_session'&&c.value&&(c.expires===-1||c.expires>now()/1000));
     if(identity&&valid){await store.save({storage,expires_at:Math.min(now()+24*3600000,...storage.cookies.filter(c=>c.name==='web_session'&&c.expires>0).map(c=>c.expires*1000))});state='connected';await closePending()}return status();
    }
    if(action!=='inspect')throw new Error('reader_action_invalid');
    if(['blocked','expired','awaiting_login'].includes(state))throw new Error('reader_'+state);
    const saved=await store.load();if(!saved||saved.expires_at<=now()){state='expired';await store.clear();cache.clear();throw new Error('reader_expired')}
    const input=platformUrl(url);if(input.platform!=='xhs')throw new Error('reader_url_invalid');const resolved=input.share?await resolvePostUrl(url,networkBudget(10000)):input;
    const key=resolved.post_id,cached=cache.get(key);if(cached&&cached.until>now())return {...cached.result,original_url:input.original_url,cache_hit:true};
    if(now()-lastRead<3000)throw new Error('reader_rate_limited');lastRead=now();
    const current=await browserSession(saved.storage);const start=now(),deadline=setTimeout(()=>current.browser.close().catch(()=>{}),25000);deadline.unref?.();
    try{
     const response=await current.page.goto(resolved.request_url,{waitUntil:'domcontentloaded',timeout:18000});const restriction=await blocked(current.page)||(await current.page.locator('.login-container .qrcode-img').isVisible()?'expired':null);if(restriction||[401,403,429].includes(response?.status())){state=restriction||'blocked';await store.clear();cache.clear();throw new Error('reader_'+state)}
     const final=platformUrl(current.page.url());if(final.post_id!==key)throw new Error('reader_identity_changed');
     // Same exact-note state shape used by the licensed MCP reference; no arbitrary script evaluation.
     await current.page.waitForFunction(id=>Boolean(window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note),key,{timeout:4000}).catch(()=>{});
     const note=await current.page.evaluate(id=>window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note||null,key);
     if(note?.noteId&&note.noteId!==key)throw new Error('reader_identity_changed');
     const html=await current.page.content();if(html.length>5000000)throw new Error('reader_limit');
     const stateScript=note?'<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteDetailMap:{[key]:{note}}}}).replace(/</g,'\\u003c')+'</script>':'';
     const result=extractMetadata(stateScript||html,resolved.request_url,'authorized_session');result.source='Authorized XHS session · staff review required';result.original_url=input.original_url;result.runtime_ms=now()-start;state='connected';
     if(result.metadata_status==='public_extracted'){if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(key,{result,until:now()+300000})}return result;
    }finally{clearTimeout(deadline);await current.browser.close()}
   }finally{busy=false}
  }
 };
}
