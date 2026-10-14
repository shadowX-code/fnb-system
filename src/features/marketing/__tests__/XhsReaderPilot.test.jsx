import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import XhsReaderPilot from '../XhsReaderPilot.jsx';
vi.mock('../../../lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture.jwt.signature'}}})}}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('keeps QR login disabled before approved configuration and exposes a clear reason',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:'The isolated Reader is not configured.'}),{status:400}));vi.stubGlobal('fetch',fetcher);render(<XhsReaderPilot org="fixture" brand="brand" onClose={()=>{}}/>);await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Reconnect with QR'}).disabled).toBe(true);expect(fetcher).toHaveBeenCalledOnce();expect(JSON.parse(fetcher.mock.calls[0][1].body).action).toBe('status');
});
it('starts QR only on explicit click, does not poll and removes QR after successful confirmation',async()=>{
 const fetcher=vi.fn(async(_url,options)=>{const action=JSON.parse(options.body).action;return new Response(JSON.stringify({status:action==='login_start'?'awaiting_login':action==='login_check'?'connected':'disconnected',live_enabled:true,session_persistence_enabled:true,...(action==='login_start'?{qr_image:'data:image/png;base64,Zml4dHVyZQ=='}:{})}))});vi.stubGlobal('fetch',fetcher);render(<XhsReaderPilot org="org" brand="brand" onClose={()=>{}}/>);const start=await screen.findByRole('button',{name:'Show Login QR'});fireEvent.click(start);await screen.findByRole('img',{name:/XHS login QR/});expect(fetcher).toHaveBeenCalledTimes(2);fireEvent.click(screen.getByRole('button',{name:'Check Status'}));await waitFor(()=>expect(screen.queryByRole('img')).toBeNull());expect(screen.getByRole('status').textContent).toContain('connected');
});
