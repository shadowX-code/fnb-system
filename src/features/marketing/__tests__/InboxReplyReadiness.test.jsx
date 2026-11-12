import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import InboxReplyComposer from '../InboxReplyComposer.jsx';
afterEach(cleanup);
vi.mock('../inboxService.js',()=>({inboxService:{}}));
vi.mock('../marketingService.js',()=>({marketingService:{}}));

const current={conversation:{id:'c',version:1,channel:'instagram',medium:'dm',status:'open',opted_out:false},reply_requires_approval:false,reply_authority:{verified:true,recent:true},window_open:true,channel_capability:{receiving_verified:true},drafts:[],outbox:[]};
function props(overrides={}){return {current,configuration:{staff_send_configured:true,recipient_allowed:true},can:()=>true,busy:false,command:vi.fn(),onDirectSend:vi.fn(),...overrides};}
it('enables normal composition without prior outbound evidence or client allowlists',()=>{
 const p=props();render(<InboxReplyComposer {...p}/>);
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Unsent draft'}});
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(false);
 expect(p.onDirectSend).not.toHaveBeenCalled();
});
it('preserves the draft while stale authority blocks sending until fresh canonical evidence arrives',()=>{
 const p=props({current:{...current,reply_authority:{verified:true,recent:false}}});
 const view=render(<InboxReplyComposer {...p}/>);
 const reply=screen.getByLabelText('Reply');expect(reply.disabled).toBe(false);
 fireEvent.change(reply,{target:{value:'Unsent draft'}});
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
 expect(screen.getByText(/Refresh connection status before sending/)).toBeTruthy();
 view.rerender(<InboxReplyComposer {...p} current={current}/>);
 expect(reply.value).toBe('Unsent draft');
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(false);
 expect(p.onDirectSend).not.toHaveBeenCalled();
});
it.each([
 {current:{...current,window_open:false}},
 {current:{...current,reply_authority:{verified:false,recent:true}}},
 {current:{...current,conversation:{...current.conversation,opted_out:true}}},
 {configuration:{staff_send_configured:false,recipient_allowed:true}},
 {configuration:{staff_send_configured:true,recipient_allowed:false}},
 {can:()=>false},
])('keeps blocked or unauthorized send unavailable (%#)',overrides=>{
 const p=props(overrides);render(<InboxReplyComposer {...p}/>);
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Unsent draft'}});
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
 expect(p.onDirectSend).not.toHaveBeenCalled();
});
it('keeps independent unsent reply and internal-note text while switching modes',()=>{
 const p=props();render(<InboxReplyComposer {...p}/>);
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Customer reply draft'}});
 fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));
 fireEvent.change(screen.getByLabelText('Internal note'),{target:{value:'Private staff note'}});
 fireEvent.click(screen.getByRole('button',{name:'Reply',exact:true}));
 expect(screen.getByLabelText('Reply').value).toBe('Customer reply draft');
 fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));
 expect(screen.getByLabelText('Internal note').value).toBe('Private staff note');
 expect(p.command).not.toHaveBeenCalled();expect(p.onDirectSend).not.toHaveBeenCalled();
});
it('restores only the exact conversation draft after chat/list navigation',()=>{
 const draftCache=new Map();const p=props({draftCache});
 const first=render(<InboxReplyComposer {...p}/>);
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Conversation C draft'}});first.unmount();
 const other=render(<InboxReplyComposer {...p} current={{...current,conversation:{...current.conversation,id:'other'}}}/>);
 expect(screen.getByLabelText('Reply').value).toBe('');
 fireEvent.change(screen.getByLabelText('Reply'),{target:{value:'Other draft'}});other.unmount();
 render(<InboxReplyComposer {...p}/>);
 expect(screen.getByLabelText('Reply').value).toBe('Conversation C draft');
 expect(p.onDirectSend).not.toHaveBeenCalled();
});
it('inserts a reviewed grounded suggestion without sending or losing the separate note',()=>{
 const p=props({current:{...current,knowledge:{approved_for_replies:true},policy:{ai_allowed:true},artifacts:[{id:'a',kind:'reply',state:'proposed',source_version:1,body:{text:'Approved fact answer',human_required:false}}]}});
 render(<InboxReplyComposer {...p}/>);fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));fireEvent.change(screen.getByLabelText('Internal note'),{target:{value:'Keep private note'}});fireEvent.click(screen.getByRole('button',{name:'Reply',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Use Reply'}));
 expect(screen.getByLabelText('Reply').value).toBe('Approved fact answer');expect(p.onDirectSend).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));expect(screen.getByLabelText('Internal note').value).toBe('Keep private note');
});
it('requires explicit human ownership before staff sends in an automatic mode',()=>{
 const p=props({current:{...current,conversation:{...current.conversation,takeover:false},ai_handling:{mode:'ai_first'}}});
 render(<InboxReplyComposer {...p}/>);expect(screen.getByText(/Take over this conversation before sending/)).toBeTruthy();
});
it('keeps WhatsApp reply and AI entry points disabled independently of general flags and hides unavailable permissions',()=>{
 const p=props({current:{...current,conversation:{...current.conversation,channel:'whatsapp'},policy:{ai_allowed:true}},configuration:{staff_send_configured:true,ai_configured:true,ai_auto_configured:true},can:permission=>permission==='manage'});
 render(<InboxReplyComposer {...p}/>);
 expect(screen.getByRole('textbox',{name:'Staff Reply'}).disabled).toBe(true);expect(screen.queryByRole('button',{name:'Send',exact:true})).toBeNull();expect(screen.queryByRole('button',{name:'AI Suggested Reply'})).toBeNull();expect(screen.queryByRole('link',{name:'View Connections'})).toBeNull();
 expect(screen.getByRole('button',{name:'Internal note'})).toBeTruthy();
});

const whatsApp = {
 ...current,
 conversation: {...current.conversation, channel:'whatsapp', takeover:true},
 window_expires_at:new Date(Date.now() + 60000).toISOString(),
};
const ready = {whatsapp_connection_ready:true, whatsapp_staff_ready:true, whatsapp_template_ready:true};

it('shows a normal WhatsApp staff reply in an authorized open window, with delivery and AI notices omitted', async () => {
 const p=props({current:{...whatsApp,outbox:[{state:'delivered'}]},configuration:ready,onDirectSend:vi.fn().mockResolvedValue(true)});
 render(<InboxReplyComposer {...p}/>);
 expect(screen.queryByRole('status')).toBeNull();
 expect(screen.queryByText(/Delivered/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Choose approved template'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Staff Reply'),{target:{value:'Thanks for your message.'}});
 const send=screen.getByRole('button',{name:'Send',exact:true});
 expect(send.disabled).toBe(false);
 fireEvent.click(send);
 await waitFor(()=>expect(screen.getByLabelText('Staff Reply').value).toBe(''));
 expect(p.onDirectSend).toHaveBeenCalledExactlyOnceWith('Thanks for your message.',null);
});

it('offers a template picker only on a closed window with exact template authority', () => {
 const p=props({
  current:{...whatsApp,window_open:false},
  configuration:{...ready,whatsapp_staff_ready:false},
  onTemplateSend:vi.fn(),
 });
 render(<InboxReplyComposer {...p}/>);
 expect(screen.getByRole('status').textContent).toBe('The 24-hour reply window is closed.');
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Choose approved template'}));
 expect(screen.getByRole('dialog',{name:'Choose approved template'})).toBeTruthy();
 expect(p.onTemplateSend).not.toHaveBeenCalled();
});

it.each([
 ['closed without exact template authority',{window_open:false},{whatsapp_template_ready:false,whatsapp_templates_configured:true},/window is closed.*Template sending is unavailable/],
 ['disconnected',{window_open:false},{whatsapp_connection_ready:false},/connection needs attention/],
 ['ineligible open window',{}, {whatsapp_template_ready:false},/sending is unavailable/],
])('shows one recovery notice for WhatsApp %s',(_label,detail,status,message)=>{
 const p=props({current:{...whatsApp,...detail},configuration:{...ready,whatsapp_staff_ready:false,...status},onTemplateSend:vi.fn(),canViewConnections:true});
 render(<InboxReplyComposer {...p}/>);
 expect(screen.getAllByRole('status')).toHaveLength(1);
 expect(screen.getByRole('status').textContent).toMatch(message);
 expect(screen.getByRole('link',{name:'View Connections'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Choose approved template'})).toBeNull();
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
});

it('saves a WhatsApp internal note independently of connection, service window and send permissions',async()=>{
 const p=props({current:{...whatsApp,window_open:false},configuration:{whatsapp_connection_ready:false},can:permission=>permission==='manage',command:vi.fn().mockResolvedValue(true)});
 render(<InboxReplyComposer {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));
 expect(screen.queryByRole('status')).toBeNull();
 fireEvent.change(screen.getByLabelText('Internal note'),{target:{value:'Follow up with the team.'}});
 fireEvent.click(screen.getByRole('button',{name:'Save note'}));
 await waitFor(()=>expect(screen.getByLabelText('Internal note').value).toBe(''));
 expect(p.command).toHaveBeenCalledExactlyOnceWith('note',{body:'Follow up with the team.'});
 expect(p.onDirectSend).not.toHaveBeenCalled();
});

it.each([
 ['staff review',{reply_requires_approval:true},/requires staff review/],
 ['unresolved send',{outbox:[{state:'reconciling'}]},/awaiting its send result/],
])('keeps WhatsApp send blocked by %s',(_label,detail,message)=>{
 render(<InboxReplyComposer {...props({current:{...whatsApp,...detail},configuration:ready})}/>);
 expect(screen.getByRole('status').textContent).toMatch(message);
 expect(screen.getByRole('button',{name:'Send',exact:true}).disabled).toBe(true);
});


it('makes approved templates available alongside a normal open-window reply',()=>{
 const p=props({current:whatsApp,configuration:ready,onTemplateSend:vi.fn()});
 render(<InboxReplyComposer {...p}/>);
 expect(screen.queryByRole('status')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Use template'}));
 expect(screen.getByRole('dialog',{name:'Choose approved template'})).toBeTruthy();
 expect(p.onTemplateSend).not.toHaveBeenCalled();
});
