import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {sessionStore} from '../../../../server/xhsReaderPilot/sessionStore.mjs';
import {createReader} from '../../../../server/xhsReaderPilot/reader.mjs';
import {readerServer} from '../../../../server/xhsReaderPilot/server.mjs';
const id='6a8fb7f30000000037034698',url='https://www.xiaohongshu.com/discovery/item/'+id+'?xsec_token=fixture';
it('encrypts and scope-binds session state with private file permissions; disconnect deletes it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'feedx-reader-fixture-'));try{const key=randomBytes(32).toString('base64'),path=join(dir,'session'),store=sessionStore(path,key,'scope');await store.save({cookies:[{value:'DISPOSABLE_FIXTURE_ONLY'}]});const raw=await readFile(path,'utf8');expect(raw).not.toContain('DISPOSABLE_FIXTURE_ONLY');expect(raw).not.toContain('cookies');expect((await stat(path)).mode&0o777).toBe(0o600);expect(await store.load()).toEqual({cookies:[{value:'DISPOSABLE_FIXTURE_ONLY'}]});await expect(sessionStore(path,key,'other-scope').load()).rejects.toThrow('reader_session_unavailable');const corrupt=JSON.parse(raw);corrupt.data='AAAA';await writeFile(path,JSON.stringify(corrupt));await expect(store.load()).rejects.toThrow('reader_session_unavailable');await store.clear();expect(await store.load()).toBeNull()}finally{await rm(dir,{recursive:true,force:true})}
});
it('never launches a browser without live and credential-storage approvals',async()=>{
 const launch=vi.fn(),store={load:vi.fn(async()=>null),clear:vi.fn()};const reader=createReader({store,launch,executablePath:'/fixture'});await expect(reader.run('login_start')).rejects.toThrow('reader_approval_required');await expect(reader.run('inspect',url)).rejects.toThrow('reader_approval_required');expect(launch).not.toHaveBeenCalled();expect(await reader.run('status')).toMatchObject({live_enabled:false,status:'disconnected'});
});
function fixture(saved,clock=10000){
 const store={load:vi.fn(async()=>saved),clear:vi.fn(async()=>{saved=null}),save:vi.fn(async value=>{saved=value})};
 let path=url,restriction='',authenticated=false,launches=0;
 const page={on:vi.fn(),goto:vi.fn(async value=>{path=value;return {status:()=>200}}),url:()=>path,locator:selector=>({innerText:async()=>restriction,isVisible:async()=>authenticated,waitFor:async()=>{},screenshot:async()=>Buffer.from('fixture-qr')}),waitForFunction:async()=>{},evaluate:async()=>({noteId:id,title:'Fixture caption <tag> :undefined, NaN',user:{userId:'61db9f8b000000001000731a',nickname:'Fixture author'},time:1600000000000,interactInfo:{likedCount:'0',collectedCount:'5'},imageList:[{urlDefault:'https://sns-img.xhscdn.com/fixture.jpg'}]}),content:async()=>'<html></html>'};
 const context={routeWebSocket:async()=>{},route:async()=>{},newPage:async()=>page,storageState:async()=>({cookies:[{name:'web_session',value:'FIXTURE',expires:-1}]})},browser={newContext:async()=>context,close:vi.fn(async()=>{})};
 const reader=createReader({store,executablePath:'/fixture',liveApproved:true,persistApproved:true,launch:async()=>{launches++;return browser},now:()=>clock});
 return {reader,store,page,browser,setRestriction:v=>restriction=v,setAuthenticated:v=>authenticated=v,launches:()=>launches};
}
it('extracts the exact note with unknown metrics distinct from zero and scoped short-lived cache',async()=>{
 const f=fixture({storage:{cookies:[]},expires_at:20000});const first=await f.reader.run('inspect',url);expect(first).toMatchObject({post_id:id,caption:'Fixture caption <tag> :undefined, NaN',author_display_name:'Fixture author',metrics:{likes:0,saves:5},source:'Authorized XHS session · staff review required'});expect(first.metrics.comments).toBeUndefined();expect(first.provenance.likes.method).toBe('authorized_session');expect(first.original_url).toBe(url);expect(f.browser.close).toHaveBeenCalledTimes(1);const second=await f.reader.run('inspect',url);expect(second.cache_hit).toBe(true);expect(second.captured_at).toBe(first.captured_at);expect(f.launches()).toBe(1);await f.reader.run('disconnect');await expect(f.reader.run('inspect',url)).rejects.toThrow('reader_expired');expect(f.launches()).toBe(1);
});
it('requires a real login signal and session cookie before encrypted persistence; no automatic polling',async()=>{
 const f=fixture(null);const qr=await f.reader.run('login_start');expect(qr.status).toBe('awaiting_login');expect(qr.qr_image).toMatch(/^data:image\/png;base64,/);expect(f.store.save).not.toHaveBeenCalled();await f.reader.run('login_check');expect(f.store.save).not.toHaveBeenCalled();f.setAuthenticated(true);expect(await f.reader.run('login_check')).toMatchObject({status:'connected'});expect(f.store.save).toHaveBeenCalledOnce();expect(f.browser.close).toHaveBeenCalledOnce();await f.reader.shutdown();
});
it('clears denied/expired sessions and never retries a challenge or reconnects automatically',async()=>{
 const f=fixture({storage:{cookies:[]},expires_at:20000});f.setRestriction('请完成安全验证');await expect(f.reader.run('inspect',url)).rejects.toThrow('reader_blocked');expect(f.store.clear).toHaveBeenCalled();await expect(f.reader.run('inspect',url)).rejects.toThrow('reader_blocked');expect(f.launches()).toBe(1);
 const expired=fixture({storage:{cookies:[]},expires_at:9000});await expect(expired.reader.run('inspect',url)).rejects.toThrow('reader_expired');expect(expired.launches()).toBe(0);
});
it('rejects concurrent requests instead of creating additional browsers',async()=>{
 const f=fixture(null);let release;f.page.goto.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));const pending=f.reader.run('login_start');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));await expect(f.reader.run('login_start')).rejects.toThrow('reader_busy');release({status:()=>200});await pending;await f.reader.shutdown();expect(f.launches()).toBe(1);
});
it('enforces canonical administrator and Brand access before Reader operations and rechecks revocation',async()=>{
 const reader={run:vi.fn(async()=>({status:'fixture'}))};let admin=false;const calls=[];const rpcFetch=vi.fn(async(u,o)=>{calls.push(u);return new Response(JSON.stringify(u.endsWith('current_user_has_permission')?admin:u.endsWith('inspection_access')?'fixture-lease':{}))});const server=readerServer({reader,org:'org',brand:'brand',anonKey:'fixture',rpcFetch});await new Promise(r=>server.listen(0,'127.0.0.1',r));const target='http://127.0.0.1:'+server.address().port+'/v1/reader';
 try{const request=body=>fetch(target,{method:'POST',headers:{Authorization:'Bearer fixture.jwt.signature'},body:JSON.stringify(body)});expect((await request({org:'org',brand:'other',action:'status'})).status).toBe(403);expect(rpcFetch).not.toHaveBeenCalled();expect((await request({org:'org',brand:'brand',action:'status'})).status).toBe(403);expect(reader.run).not.toHaveBeenCalled();admin=true;expect((await request({org:'org',brand:'brand',action:'inspect',url})).status).toBe(200);expect(calls.some(x=>x.endsWith('marketing_creator_inspection_access'))).toBe(true);reader.run.mockImplementationOnce(async()=>{admin=false;return {caption:'MUST NOT DISCLOSE'}});const denied=await request({org:'org',brand:'brand',action:'inspect',url});expect(denied.status).toBe(403);expect(await denied.text()).not.toContain('MUST NOT DISCLOSE')}finally{await new Promise(r=>server.close(r))}
});
