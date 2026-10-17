import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import MarketingFAQPage from '../MarketingFAQPage.jsx';
import {useAuth} from '../../../auth/AuthContext.jsx';
import {marketingService} from '../marketingService.js';
import {inboxService} from '../inboxService.js';
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:vi.fn()}));
vi.mock('../marketingService.js',()=>({marketingService:{context:vi.fn()}}));
vi.mock('../inboxService.js',()=>({inboxService:{faqSettings:vi.fn(),configuration:vi.fn(),configure:vi.fn()}}));
afterEach(cleanup);
const template={key:'greeting',name:'Greeting',answers:{EN:'Hello! How can we help you?',ZH:'您好！有什么可以帮您？',BM:'Hai! Ada apa yang boleh kami bantu?'}};
const faq={id:'f',revision:1,question:'Hello',answer:template.answers.EN,answer_kind:'general',template_key:'greeting',language:'EN',category:'Greeting',reference_keys:[],alternative_questions:['Hi'],status:'draft',match_intent:'greeting'};
beforeEach(()=>{vi.resetAllMocks();useAuth.mockReturnValue({user:{id:'u'},hasPermission:()=>true});marketingService.context.mockResolvedValue({organizations:[{id:'o'}],brands:[{id:'b',name:'Brand B',organization_id:'o'}]});inboxService.configuration.mockResolvedValue({ai_configured:false});inboxService.faqSettings.mockResolvedValue({knowledge:null,faqs:[faq],general_templates:[template],policy:null});inboxService.configure.mockResolvedValue({});});
it('manages Brand FAQs independently of knowledge approval and searches alternatives',async()=>{
 render(<MarketingFAQPage/>);await screen.findByRole('button',{name:'New FAQ'});await screen.findByText('Hello');
 expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(false);
 fireEvent.change(screen.getByRole('searchbox',{name:'Search FAQs'}),{target:{value:'Hi'}});expect(screen.getByText('Hello')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Actions for Hello'}));fireEvent.click(await screen.findByRole('menuitem',{name:'Approve FAQ'}));
 await waitFor(()=>expect(inboxService.configure).toHaveBeenCalledWith(expect.any(String),'b',1,'approve_faq',{id:'f'}));
});
it('keeps drafts available before knowledge and exposes an accessible fixed-footer editor',async()=>{
 render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('button',{name:'Save draft'}).getAttribute('form')).toBe('faq-editor-form');
 fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'New question'}});fireEvent.change(screen.getByRole('textbox',{name:'Answer for review'}),{target:{value:'Draft-only answer'}});
 fireEvent.submit(document.getElementById('faq-editor-form'));await waitFor(()=>expect(inboxService.configure).toHaveBeenCalledWith(expect.any(String),'b',0,'save_faq',expect.objectContaining({question:'New question',answer:'Draft-only answer',reference_keys:[],answer_kind:'factual'})));
});
it('blocks unsupported factual approval and hides unauthorized changes',async()=>{
 inboxService.faqSettings.mockResolvedValue({knowledge:null,faqs:[{...faq,answer_kind:'factual'}],general_templates:[template]});render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('button',{name:'Actions for Hello'}));expect((await screen.findByRole('menuitem',{name:'Approve FAQ'})).disabled).toBe(true);
 cleanup();useAuth.mockReturnValue({user:{id:'u'},hasPermission:()=>false});render(<MarketingFAQPage/>);await screen.findByText('Hello');expect(screen.queryByRole('button',{name:'New FAQ'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'Approve FAQ'})).toBeNull();
});
