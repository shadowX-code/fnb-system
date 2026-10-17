import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import InboxReplyComposer from '../InboxReplyComposer.jsx';
afterEach(cleanup);
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
 render(<InboxReplyComposer {...p}/>);fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));fireEvent.change(screen.getByLabelText('Internal note'),{target:{value:'Keep private note'}});fireEvent.click(screen.getByRole('button',{name:'Reply',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Use suggestion'}));
 expect(screen.getByLabelText('Reply').value).toBe('Approved fact answer');expect(p.onDirectSend).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));expect(screen.getByLabelText('Internal note').value).toBe('Keep private note');
});
