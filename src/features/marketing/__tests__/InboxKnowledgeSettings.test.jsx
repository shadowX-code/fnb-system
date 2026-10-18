import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import InboxKnowledgeSettings from '../InboxKnowledgeSettings.jsx';
import {aiSuggestionUnavailable,faqPreviewMessage,faqApprovalUnavailable,faqStateLabel} from '../inboxKnowledge.js';
afterEach(cleanup);
const data={knowledge:{revision:3,approved_for_replies:true,profile:{identity:{text:'Verified identity',provenance:'verified_brand_fact'},research:{text:'Excluded research',provenance:'external_research'}}},policy:{revision:1,automation_mode:'suggest',ai_allowed:false,staff_reply_requires_approval:true},faqs:[{id:'f',question:'Brand question',answer:'Verified identity',status:'approved',category:'Identity',language:'EN',knowledge_revision:3,revision:1,reference_keys:['identity'],alternative_questions:['Another phrasing']}]};
const props=()=>({data,configuration:{ai_configured:false},can:()=>true,busy:false,configure:vi.fn(),onEdit:vi.fn(),onKnowledge:'/marketing/brand-knowledge'});
it('keeps fact verification separate from FAQ approval and preserves policy',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,knowledge:{...data.knowledge,approved_for_replies:false}}}/>);
 expect(screen.queryByRole('button',{name:'New FAQ'})).toBeNull();expect(screen.queryByText('Excluded research')).toBeNull();
 expect(screen.queryByRole('button',{name:'Approve this knowledge revision'})).toBeNull();expect(screen.getByRole('link',{name:'Open Brand Knowledge'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Save brand settings'}));expect(p.configure).toHaveBeenCalledWith('policy',1,expect.objectContaining({staff_reply_requires_approval:true}));
});
it('hides policy mutation from unauthorized readers',()=>{render(<InboxKnowledgeSettings {...props()} can={()=>false}/>);expect(screen.queryByRole('button',{name:'Save brand settings'})).toBeNull()});
it('distinguishes knowledge, Brand consent, provider and matching availability',()=>{
 expect(aiSuggestionUnavailable({},{})).toMatch(/disabled for this Brand/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true}},{})).toMatch(/disabled for this Brand/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{})).toMatch(/provider is unavailable/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{ai_configured:true})).toBe('');
 expect(faqPreviewMessage({state:'off'})).toMatch(/disabled/);expect(faqPreviewMessage({state:'escalate'})).toMatch(/person/);
});

it('keeps factual support strict while allowing only supplied general templates',()=>{
 expect(faqApprovalUnavailable({...data.faqs[0],knowledge_revision:2},data.knowledge)).toMatch(/current Brand Knowledge revision/);
 const t={key:'greeting',answers:{EN:'Hello!'}};const f={answer_kind:'general',template_key:'greeting',language:'EN',answer:'Hello!',reference_keys:[]};
 expect(faqApprovalUnavailable(f,null,[t])).toBe('');expect(faqApprovalUnavailable({...f,answer:'Open 24 hours'},null,[t])).toMatch(/fact-free/);expect(faqStateLabel({status:'review'})).toBe('Pending Approval');
});
it('exposes three modes with a server pause and mandatory safety, never silently enabling a Brand',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,policy:{...data.policy,ai_allowed:true,ai_reply_mode:'ai_first'}}} configuration={{ai_configured:true,ai_auto_configured:false,ai_model:'gpt-5-mini'}}/>);
 expect(screen.getByText('AI First')).toBeTruthy();expect(screen.getByText('Automatic delivery is disabled by the server.')).toBeTruthy();expect(screen.getByText(/Safety escalation is mandatory/)).toBeTruthy();expect(p.configure).not.toHaveBeenCalled();
});
