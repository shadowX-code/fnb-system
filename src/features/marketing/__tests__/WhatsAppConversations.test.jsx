import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import MarketingInboxPage from '../MarketingInboxPage.jsx';
import {inboxService} from '../inboxService.js';
import {marketingService} from '../marketingService.js';
import {conversationTimeline} from '../inboxPresentation.js';
import {context,conversation,detail,read} from '../../../../qa/marketing/inbox/fixtures.js';
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'fixture-user'},hasPermission:()=>true})}));
vi.mock('../marketingService.js',()=>({marketingService:{context:vi.fn()}}));
vi.mock('../inboxService.js',()=>({inboxService:Object.fromEntries(['read','detail','configuration','analytics','profiles','markRead','sendStatus','preview','suggest','command','resumeAI','sendStaffReply'].map(key=>[key,vi.fn()]))}));
afterEach(cleanup);
beforeEach(()=>{vi.resetAllMocks();marketingService.context.mockResolvedValue(context);inboxService.read.mockImplementation(async options=>read(options));inboxService.detail.mockImplementation(async(id,page)=>detail(page));inboxService.configuration.mockResolvedValue({ai_configured:true,ai_auto_configured:true,staff_send_configured:true});inboxService.analytics.mockResolvedValue({});inboxService.profiles.mockResolvedValue({profiles:{}});inboxService.sendStatus.mockResolvedValue({recipient_allowed:true});inboxService.markRead.mockResolvedValue(null)});
async function open(){render(<MarketingInboxPage/>);fireEvent.click(await screen.findByRole('button',{name:/Fixture customer/}));await screen.findByText('Can I see the menu?',{selector:'p'})}
it('renders canonical provenance, all media fallbacks and exact receipt states without activating AI or sending',async()=>{
 await open();
 for(const label of ['Image','Video','Document','Audio','Sticker','Unsupported message'])expect(screen.getByRole('group',{name:`${label} · preview unavailable`})).toBeTruthy();
 expect(screen.getByText('Mobile app reply · outside FeedX ·')).toBeTruthy();
 expect(screen.getAllByText('Synced history · automation excluded ·')).toHaveLength(2);
 expect(screen.getAllByText('Live inbound ·').length).toBeGreaterThan(0);
 for(const label of ['Provider accepted','Delivered','Read','Failed','Unknown · reconciling'])expect(screen.getByText(label)).toBeTruthy();
 expect(screen.getByRole('textbox',{name:'Staff Reply'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'AI Suggested Reply'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Send',exact:true}));
 expect(inboxService.sendStaffReply).not.toHaveBeenCalled();expect(inboxService.preview).not.toHaveBeenCalled();expect(inboxService.suggest).not.toHaveBeenCalled();expect(inboxService.command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Show customer details'}));
 expect(screen.getByRole('button',{name:'Human handling · AI disabled'}).disabled).toBe(true);
 expect(inboxService.resumeAI).not.toHaveBeenCalled();
});
it('pages long histories through the canonical detail reader and clears all conversation data on Brand change',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Older messages'}));await screen.findByText('Older message 1');expect(inboxService.detail).toHaveBeenCalledWith(conversation.id,2);
 fireEvent.click(screen.getByRole('button',{name:'Brand',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Fixture Brand B'}));
 await screen.findByText('No conversations match your filters.');expect(screen.queryByText('Older message 1')).toBeNull();expect(screen.queryByRole('textbox',{name:'Staff Reply'})).toBeNull();
 expect(inboxService.read).toHaveBeenLastCalledWith(expect.objectContaining({brand:'brand-b',page:1}));
});
it('retains canonical insertion sequence when provider timestamps tie',()=>{const result=conversationTimeline({conversation:{channel:'whatsapp'},messages:[{id:'a',kind:'incoming',occurred_at:'2026-10-23T01:00:00Z',sequence:2},{id:'z',kind:'incoming',occurred_at:'2026-10-23T01:00:00Z',sequence:1}]});expect(result.map(m=>m.id)).toEqual(['z','a'])});
it('keeps WhatsApp search/channel/unread filters in the canonical reader and explains the empty state',async()=>{
 render(<MarketingInboxPage/>);await screen.findByText('Fixture customer');
 fireEvent.click(screen.getByRole('button',{name:'Channel',exact:true}));fireEvent.click(screen.getByRole('option',{name:'WhatsApp',exact:true}));
 await waitFor(()=>expect(inboxService.read).toHaveBeenLastCalledWith(expect.objectContaining({channel:'whatsapp'})));
 fireEvent.click(screen.getByRole('button',{name:'More filters',exact:true}));fireEvent.click(screen.getByRole('checkbox',{name:'Unread only'}));
 await waitFor(()=>expect(inboxService.read).toHaveBeenLastCalledWith(expect.objectContaining({channel:'whatsapp',unread:true})));
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'no match'}});
 await screen.findByText('No conversations match your filters.');
 expect(screen.getByText(/WhatsApp onboarding is disabled/)).toBeTruthy();expect(inboxService.read).toHaveBeenLastCalledWith(expect.objectContaining({channel:'whatsapp',search:'no match',page:1}));
});
it('uses the existing note authority without making a WhatsApp draft or enabling replies',async()=>{
 inboxService.command.mockResolvedValue({conversation});await open();
 fireEvent.click(screen.getByRole('button',{name:'Internal note',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Internal note'}),{target:{value:'Private fixture note'}});fireEvent.click(screen.getByRole('button',{name:'Save note'}));
 await waitFor(()=>expect(inboxService.command).toHaveBeenCalledWith(expect.any(String),'org','brand-a',conversation,'note',{body:'Private fixture note'}));
 fireEvent.click(screen.getByRole('button',{name:'Staff Reply',exact:true}));expect(screen.getByRole('textbox',{name:'Staff Reply'}).disabled).toBe(true);expect(inboxService.sendStaffReply).not.toHaveBeenCalled();
});

it('preserves the Production FB/IG timestamp tie behavior',()=>{for(const channel of ['facebook','instagram']){const result=conversationTimeline({conversation:{channel},messages:[{id:'a',kind:'incoming',occurred_at:'2026-10-23T01:00:00Z',sequence:2},{id:'z',kind:'incoming',occurred_at:'2026-10-23T01:00:00Z',sequence:1}]});expect(result.map(m=>m.id)).toEqual(['a','z'])}});
