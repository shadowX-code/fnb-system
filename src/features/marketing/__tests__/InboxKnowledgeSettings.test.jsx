import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import InboxKnowledgeSettings from '../InboxKnowledgeSettings.jsx';
import {aiSuggestionUnavailable,faqPreviewMessage,faqApprovalUnavailable,faqStateLabel} from '../inboxKnowledge.js';
afterEach(cleanup);
const data={knowledge:{manager_confirmed:true},policy:{revision:3,automation_mode:'suggest',ai_allowed:true,ai_reply_mode:'suggest_only',staff_reply_requires_approval:false},faqs:[{is_active:true},{is_active:false}]};
const props=()=>({data,configuration:{ai_configured:true,ai_auto_configured:false},can:()=>true,busy:false,configure:vi.fn(),onKnowledge:'/marketing/brand-knowledge',onConnections:'/marketing/connections'});
const choose=mode=>fireEvent.click(screen.getByRole('radio',{name:new RegExp(mode)}));
it('separates draft mode from saved status and cancels without a mutation',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p}/>);
 expect(screen.getByText('Staff review only')).toBeTruthy();expect(screen.queryByText('Automatic reply availability')).toBeNull();
 choose('AI First');expect(screen.getByText('Draft selection')).toBeTruthy();expect(screen.getByText('Staff review only')).toBeTruthy();expect(screen.getByLabelText('Saved AI status').textContent).toContain('Saved mode Suggest Only');
 expect(screen.getByText('Automatic delivery is disabled by the server.')).toBeTruthy();expect(screen.getByText('Automatic reply availability')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByText('Draft selection')).toBeNull();expect(screen.queryByText('Automatic reply availability')).toBeNull();expect(p.configure).not.toHaveBeenCalled();
});
it('submits the existing revision-bound contract including consent and staff policy',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p}/>);choose('Safe Auto Reply');fireEvent.click(screen.getByRole('checkbox',{name:/Require approval/}));fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(p.configure).toHaveBeenCalledWith('policy',3,{automation_mode:'suggest',ai_allowed:true,ai_reply_mode:'safe_auto',staff_reply_requires_approval:true,ai_availability:'always',ai_timezone:'Asia/Kuala_Lumpur',ai_schedule:{days:[0,1,2,3,4,5,6],start:'09:00',end:'22:00'}});
});
it('keeps automatic save consent/permission guards and allows manual setup independently',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} can={a=>a!=='send'} data={{...data,policy:{...data.policy,ai_allowed:false}}}/>);choose('AI First');expect(screen.getByRole('button',{name:'Save changes'}).disabled).toBe(true);expect(screen.getByText('Additional permission needed')).toBeTruthy();
 choose('Suggest Only');fireEvent.click(screen.getByRole('checkbox',{name:/Require approval/}));expect(screen.getByRole('button',{name:'Save changes'}).disabled).toBe(false);
});
it('shows only known blockers and does not require optional Brand Knowledge or FAQs',()=>{
 render(<InboxKnowledgeSettings {...props()} data={{...data,knowledge:null,faqs:[]}}/>);expect(screen.getByText('Setup ready')).toBeTruthy();expect(screen.queryByText('Brand consent needed')).toBeNull();expect(screen.getByRole('link',{name:/Open Brand Knowledge/})).toBeTruthy();expect(screen.getByText(/Missing optional knowledge does not block/)).toBeTruthy();expect(screen.queryByText('Automatic delivery paused')).toBeNull();
});
it('does not claim saved automatic modes are active without conversation authority',()=>{
 render(<InboxKnowledgeSettings {...props()} data={{...data,policy:{...data.policy,ai_reply_mode:'ai_first'}}} configuration={{ai_configured:true,ai_auto_configured:true}}/>);expect(screen.getByText('Automatic mode saved')).toBeTruthy();expect(screen.getByText('Each conversation must pass send checks.')).toBeTruthy();expect(screen.queryByText('Active')).toBeNull();
});
it('preserves drafts when configuration fails and supports a read-only retry',()=>{
 const retry=vi.fn();render(<InboxKnowledgeSettings {...props()} configuration={null} configurationError="Network unavailable" onRetryConfiguration={retry}/>);choose('Safe Auto Reply');fireEvent.click(screen.getByRole('button',{name:'Retry check'}));expect(retry).toHaveBeenCalledOnce();expect(screen.getByText('Draft selection')).toBeTruthy();expect(screen.getByText('Status unavailable')).toBeTruthy();
});
it('renders readers without mutation actions and locks all controls while saving',()=>{
 const p=props();const {rerender}=render(<InboxKnowledgeSettings {...p} can={()=>false}/>);expect(screen.queryByRole('button',{name:'Save changes'})).toBeNull();expect(screen.getByRole('radio',{name:/AI First/}).matches(':disabled')).toBe(true);
 rerender(<InboxKnowledgeSettings {...p} busy/>);expect(screen.getByRole('checkbox',{name:/Allow AI/}).disabled).toBe(true);expect(screen.getByRole('button',{name:'Saving…'}).disabled).toBe(true);
});
it('keeps failed drafts until the canonical saved revision changes',()=>{
 const p=props();const {rerender}=render(<InboxKnowledgeSettings {...p}/>);choose('AI First');rerender(<InboxKnowledgeSettings {...p} busy={false}/>);expect(screen.getByText('Draft selection')).toBeTruthy();rerender(<InboxKnowledgeSettings {...p} data={{...data,policy:{...data.policy,revision:4,ai_reply_mode:'ai_first'}}}/>);expect(screen.queryByText('Draft selection')).toBeNull();expect(screen.getByText('Automatic sending paused')).toBeTruthy();
});

it('distinguishes knowledge, Brand consent, provider and matching availability',()=>{
 expect(aiSuggestionUnavailable({},{})).toMatch(/disabled for this Brand/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true}},{})).toMatch(/disabled for this Brand/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{})).toMatch(/provider is unavailable/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{ai_configured:true})).toBe('');
 expect(faqPreviewMessage({state:'off'})).toMatch(/disabled/);expect(faqPreviewMessage({state:'escalate'})).toMatch(/person/);
});

it('keeps factual support strict while allowing only supplied general templates',()=>{
 expect(faqApprovalUnavailable({...{knowledge_revision:3},knowledge_revision:2},{revision:3,approved_for_replies:true})).toMatch(/current Brand Knowledge revision/);
 const t={key:'greeting',answers:{EN:'Hello!'}};const f={answer_kind:'general',template_key:'greeting',language:'EN',answer:'Hello!',reference_keys:[]};
 expect(faqApprovalUnavailable(f,null,[t])).toBe('');expect(faqApprovalUnavailable({...f,answer:'Open 24 hours'},null,[t])).toMatch(/fact-free/);expect(faqStateLabel({status:'review'})).toBe('Pending Approval');
});
it('preserves existing scheduled days, overnight times and timezone across mode changes',()=>{
 const p=props(),schedule={days:[1,3],start:'22:00',end:'02:00'};render(<InboxKnowledgeSettings {...p} data={{...data,policy:{...data.policy,ai_reply_mode:'ai_first',ai_availability:'scheduled',ai_timezone:'Asia/Singapore',ai_schedule:schedule}}}/>);
 expect(screen.getByRole('checkbox',{name:'Mon'}).checked).toBe(true);expect(screen.getByRole('checkbox',{name:'Tue'}).checked).toBe(false);expect(screen.getByRole('button',{name:'Starts'}).textContent).toContain('10:00 pm');expect(screen.getByRole('button',{name:'Ends'}).textContent).toContain('2:00 am');
 choose('Suggest Only');expect(screen.queryByRole('button',{name:'Starts'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Save changes'}));expect(p.configure).toHaveBeenCalledWith('policy',3,expect.objectContaining({ai_availability:'scheduled',ai_timezone:'Asia/Singapore',ai_schedule:schedule,ai_reply_mode:'suggest_only'}));
});
it('uses canonical channel evidence only for automatic setup and never blocks healthy channels for other accounts',()=>{
 const p=props(),{rerender}=render(<InboxKnowledgeSettings {...p} channels={{connections:[]}}/>);expect(screen.queryByText('No connected Inbox channel')).toBeNull();choose('AI First');expect(screen.getByText('No connected Inbox channel')).toBeTruthy();
 rerender(<InboxKnowledgeSettings {...p} channels={{connections:[{messaging:{receiving_verified:true}},{messaging:{receiving_verified:false}}]}}/>);expect(screen.queryByText('Inbox channels need attention')).toBeNull();expect(screen.queryByText('No connected Inbox channel')).toBeNull();expect(screen.getByText(/1 of 2 channels/)).toBeTruthy();
});
