import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {InboxOperationalViews,InboxHandlingBar,inboxHandlingState} from '../InboxOperations.jsx';
afterEach(cleanup);
it('keeps operational views separate from status, exposes scoped counts and keyboard selection',()=>{
 const change=vi.fn();render(<InboxOperationalViews value="all" onChange={change} counts={{all:10,needs_reply:3,mine:2,ai_handoff:1}}/>);
 const group=screen.getByRole('tablist',{name:'Conversation views'});
 expect(within(group).getByRole('tab',{name:'Needs Reply 3'})).toBeTruthy();
 fireEvent.keyDown(within(group).getByRole('tab',{name:'All 10'}),{key:'ArrowRight'});expect(change).toHaveBeenCalledWith('needs_reply');
});
it('does not claim automatic handling while the independent runtime gate is off',()=>{
 expect(inboxHandlingState({takeover:false},'ai_first',false).label).toBe('AI paused');
 expect(inboxHandlingState({takeover:false},'ai_first',true).label).toBe('AI Handling');
 expect(inboxHandlingState({takeover:true},'ai_first',true).label).toBe('Staff Taken Over');
});
it('allows staff takeover during risk escalation but keeps Resume protected',()=>{
 const takeover=vi.fn(),resume=vi.fn(),current={conversation:{id:'c',channel:'facebook',takeover:false,status:'open',escalation_reasons:['human_request']},ai_handling:{mode:'ai_first'}};
 const {rerender}=render(<InboxHandlingBar current={current} configuration={{ai_auto_configured:true}} can={()=>true} busy={false} onTakeover={takeover} onResume={resume}/>);
 fireEvent.click(screen.getByRole('button',{name:'Take Over'}));expect(takeover).toHaveBeenCalledOnce();expect(screen.getByText('Human Attention')).toBeTruthy();
 rerender(<InboxHandlingBar current={{...current,conversation:{...current.conversation,takeover:true}}} configuration={{ai_auto_configured:true}} can={()=>true} busy={false} onResume={resume}/>);
 expect(screen.getByRole('button',{name:'Resume AI'}).disabled).toBe(true);expect(resume).not.toHaveBeenCalled();
});
it('keeps AI Handoff distinct from the three primary views and preserves overlapping counts',()=>{
 const onChange=vi.fn();render(<InboxOperationalViews value="ai_handoff" onChange={onChange} counts={{all:11,needs_reply:11,mine:0,ai_handoff:2}}/>);
 const primary=screen.getByRole('tablist',{name:'Conversation views'});expect(within(primary).getAllByRole('tab')).toHaveLength(3);expect(within(primary).getByRole('tab',{name:'Mine 0'})).toBeTruthy();expect(within(primary).queryByText('AI Handoff')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'AI Handoff 2'}));expect(onChange).toHaveBeenCalledWith('ai_handoff');
});
