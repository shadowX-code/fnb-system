import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import InboxKnowledgeSettings from '../InboxKnowledgeSettings.jsx';
import {aiSuggestionUnavailable,faqPreviewMessage,faqApprovalUnavailable,faqStateLabel} from '../inboxKnowledge.js';
afterEach(cleanup);
const data={knowledge:{revision:3,approved_for_replies:true,profile:{identity:{text:'Verified identity',provenance:'verified_brand_fact'},research:{text:'Excluded research',provenance:'external_research'}}},policy:{revision:1,automation_mode:'suggest',ai_allowed:false,staff_reply_requires_approval:true},faqs:[{id:'f',question:'Brand question',answer:'Verified identity',status:'approved',category:'Identity',language:'EN',knowledge_revision:3,revision:1,reference_keys:['identity'],alternative_questions:['Another phrasing']}]};
const props=()=>({data,configuration:{ai_configured:false},can:()=>true,busy:false,configure:vi.fn(),onEdit:vi.fn(),onKnowledge:'/marketing/brand-knowledge'});
it('allows FAQ drafting before approval while explaining the approval prerequisite',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,knowledge:{...data.knowledge,approved_for_replies:false}}}/>);
 expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(false);
 expect(screen.getByRole('button',{name:'Edit FAQ'}).disabled).toBe(false);
 expect(screen.getByText('Approve Brand Knowledge revision 3 for replies.')).toBeTruthy();
 expect(screen.queryByText('Excluded research')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Approve this knowledge revision'}));expect(p.configure).toHaveBeenCalledWith('approve_knowledge',3);
});
it('allows authorized creation and editing without changing approval authority',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));expect(p.onEdit).toHaveBeenCalledWith(expect.objectContaining({revision:0,alternative_questions:[],category:'General'}));
 fireEvent.click(screen.getByRole('button',{name:'Edit FAQ'}));expect(p.onEdit).toHaveBeenCalledWith(data.faqs[0]);
 fireEvent.click(screen.getByRole('button',{name:'Disable FAQ'}));expect(p.configure).toHaveBeenCalledWith('disable_faq',1,{id:'f'});
});
it('searches alternative phrasings and preserves category filtering',()=>{
 render(<InboxKnowledgeSettings {...props()}/>);fireEvent.change(screen.getByRole('searchbox',{name:'Search FAQs'}),{target:{value:'Another phrasing'}});expect(screen.getByText('Brand question')).toBeTruthy();
 fireEvent.change(screen.getByRole('searchbox',{name:'Search FAQs'}),{target:{value:'Unmatched'}});expect(screen.queryByText('Brand question')).toBeNull();expect(screen.getByText('No FAQs match these filters.')).toBeTruthy();
});
it('does not expose unauthorized mutation actions or silently relax reply approval',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} can={()=>false}/>);expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(true);expect(screen.queryByRole('button',{name:'Edit FAQ'})).toBeNull();expect(screen.queryByRole('button',{name:'Save brand settings'})).toBeNull();expect(p.configure).not.toHaveBeenCalled();
});
it('retains the 100 FAQ cap and saves existing approval policy explicitly',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,faqs:Array.from({length:100},(_,i)=>({...data.faqs[0],id:String(i)}))}}/>);expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Save brand settings'}));expect(p.configure).toHaveBeenCalledWith('policy',1,expect.objectContaining({staff_reply_requires_approval:true,ai_allowed:false}));
});
it('distinguishes knowledge, Brand consent, provider and matching availability',()=>{
 expect(aiSuggestionUnavailable({},{})).toMatch(/Knowledge/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true}},{})).toMatch(/disabled for this Brand/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{})).toMatch(/provider is unavailable/);
 expect(aiSuggestionUnavailable({knowledge:{approved_for_replies:true},policy:{ai_allowed:true}},{ai_configured:true})).toBe('');
 expect(faqPreviewMessage({state:'off'})).toMatch(/disabled/);expect(faqPreviewMessage({state:'escalate'})).toMatch(/person/);
});

it('supports first-time drafting with no knowledge and a direct setup link',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,knowledge:null,faqs:[]}}/>);
 expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(false);
 expect(screen.getByText(/Start by drafting your common customer questions/)).toBeTruthy();
 expect(screen.getAllByRole('link',{name:'Open Brand Knowledge'}).length).toBeGreaterThan(0);
});
it('distinguishes draft preparation from supported pending approval',()=>{
 const p=props();const faq={...data.faqs[0],status:'draft'};
 const view=render(<InboxKnowledgeSettings {...p} data={{...data,faqs:[faq]}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Request approval'}));expect(p.configure).toHaveBeenCalledWith('request_faq_review',1,{id:'f'});
 view.rerender(<InboxKnowledgeSettings {...p} data={{...data,faqs:[{...faq,status:'review',revision:2}]}}/>);
 expect(screen.getByText('Pending Approval')).toBeTruthy();expect(screen.queryByRole('button',{name:'Request approval'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Approve exact FAQ'}));expect(p.configure).toHaveBeenCalledWith('approve_faq',2,{id:'f'});
});
it('keeps approvals blocked for missing or stale facts while permitting editing',()=>{
 const p=props();render(<InboxKnowledgeSettings {...p} data={{...data,faqs:[{...data.faqs[0],status:'draft',reference_keys:[]}]}}/>);
 expect(screen.getByRole('button',{name:'Edit FAQ'}).disabled).toBe(false);
 expect(screen.getByRole('button',{name:'Request approval'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'Approve exact FAQ'}).disabled).toBe(true);
 expect(faqApprovalUnavailable({...data.faqs[0],knowledge_revision:2},data.knowledge)).toMatch(/current Brand Knowledge revision/);
 expect(faqStateLabel({status:'disabled'})).toBe('Disabled');
});
