import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import MarketingFAQPage from '../MarketingFAQPage.jsx';
import {useAuth} from '../../../auth/AuthContext.jsx';
import {marketingService} from '../marketingService.js';
import {inboxService} from '../inboxService.js';
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:vi.fn()}));
vi.mock('../marketingService.js',()=>({marketingService:{context:vi.fn(),socialAccounts:vi.fn()}}));
vi.mock('../inboxService.js',()=>({inboxService:{faqSettings:vi.fn(),configuration:vi.fn(),configure:vi.fn()}}));
afterEach(cleanup);
const template={key:'greeting',name:'Greeting',answers:{EN:'Hello! How can we help you?',ZH:'您好！有什么可以帮您？',BM:'Hai! Ada apa yang boleh kami bantu?'}};
const faq={id:'f',revision:1,question:'Hello',answer:template.answers.EN,answer_kind:'general',template_key:'greeting',language:'EN',category:'general',reference_keys:[],alternative_questions:['Hi'],status:'draft',match_intent:'greeting'};
beforeEach(()=>{vi.resetAllMocks();useAuth.mockReturnValue({user:{id:'u'},hasPermission:()=>true});marketingService.context.mockResolvedValue({organizations:[{id:'o'}],brands:[{id:'b',name:'Brand B',organization_id:'o'}]});marketingService.socialAccounts.mockResolvedValue({connections:[]});inboxService.configuration.mockResolvedValue({ai_configured:false});inboxService.faqSettings.mockResolvedValue({knowledge:null,faqs:[faq],general_templates:[template],policy:null});inboxService.configure.mockResolvedValue({});});
it('activates an existing FAQ without a knowledge approval dependency',async()=>{
 render(<MarketingFAQPage/>);await screen.findByText('Hello');
 expect(screen.getByRole('button',{name:'New FAQ'}).disabled).toBe(false);
 fireEvent.change(screen.getByRole('searchbox',{name:'Search FAQs'}),{target:{value:'Hi'}});expect(screen.getByText('Hello')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Actions for Hello'}));fireEvent.click(await screen.findByRole('menuitem',{name:'Activate',exact:true}));
 await waitFor(()=>expect(inboxService.configure).toHaveBeenCalledWith(expect.any(String),'b',1,'activate_faq',{id:'f'}));
 expect(screen.queryByRole('menuitem',{name:'Approve FAQ'})).toBeNull();
});
it('saves a natural answer active with a standard category and fixed-footer actions',async()=>{
 render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));
 expect(screen.getByRole('button',{name:'Save & Activate'}).getAttribute('form')).toBe('faq-editor-form');
 expect(screen.getByRole('button',{name:'Save Inactive'}).getAttribute('form')).toBe('faq-editor-form');
 fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'New question'}});fireEvent.change(screen.getByRole('textbox',{name:'Answer'}),{target:{value:'A natural reply'}});
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Category *',exact:true}));fireEvent.click(await screen.findByRole('option',{name:'Services',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Save & Activate'}));await waitFor(()=>expect(inboxService.configure).toHaveBeenCalledWith(expect.any(String),'b',0,'save_faq',expect.objectContaining({question:'New question',answer:'A natural reply',category:'services',is_active:true})));
});
it('keeps inactive save separate and hides unauthorized mutations',async()=>{
 render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'Draft question'}});fireEvent.change(screen.getByRole('textbox',{name:'Answer'}),{target:{value:'Draft answer'}});fireEvent.click(screen.getByRole('button',{name:'Save Inactive'}));
 await waitFor(()=>expect(inboxService.configure).toHaveBeenCalledWith(expect.any(String),'b',0,'save_faq',expect.objectContaining({is_active:false})));
 cleanup();useAuth.mockReturnValue({user:{id:'u'},hasPermission:()=>false});render(<MarketingFAQPage/>);await screen.findByText('Hello');expect(screen.queryByRole('button',{name:'New FAQ'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Actions for Hello'}));expect(screen.queryByRole('menuitem',{name:'Activate'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'Edit'})).toBeNull();
});
it('shows only primary fields and operational availability without blocking management',async()=>{
 inboxService.faqSettings.mockResolvedValue({faqs:[{...faq,is_active:true,use_issue:'Staff must confirm the Outlet.'}]});
 render(<MarketingFAQPage/>);await screen.findByText('Hello');expect(screen.getByText('Staff must confirm the Outlet.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));expect(screen.queryByText('Advanced Options')).toBeNull();expect(screen.queryByText('Supporting knowledge')).toBeNull();expect(screen.getByRole('textbox',{name:'Alternative Questions'})).toBeTruthy();
});

it('keeps a failed save visible inside the editor without closing the draft',async()=>{
 inboxService.configure.mockRejectedValue(new Error('FAQ changed. Reload before saving.'));render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('button',{name:'New FAQ'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Question'}),{target:{value:'Unsaved question'}});fireEvent.change(screen.getByRole('textbox',{name:'Answer'}),{target:{value:'Unsaved answer'}});fireEvent.click(screen.getByRole('button',{name:'Save Inactive'}));
 expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveProperty('textContent','FAQ changed. Reload before saving.');expect(screen.getByRole('textbox',{name:'Question'}).value).toBe('Unsaved question');
});
it('keeps configuration retry read-only and preserves the selected draft',async()=>{
 inboxService.configuration.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ai_configured:true,ai_auto_configured:false});render(<MarketingFAQPage/>);await screen.findByText('Hello');fireEvent.click(screen.getByRole('tab',{name:'AI & Reply Settings'}));await screen.findByText('Configuration unavailable');fireEvent.click(screen.getByRole('radio',{name:/AI First/}));fireEvent.click(screen.getByRole('button',{name:'Retry check'}));await waitFor(()=>expect(inboxService.configuration).toHaveBeenCalledTimes(2));expect(screen.getByText('Draft selection')).toBeTruthy();expect(inboxService.configure).not.toHaveBeenCalled();expect(marketingService.socialAccounts).toHaveBeenCalledWith('o','b');
});
