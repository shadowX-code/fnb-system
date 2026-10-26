import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import InboxAIPlayground from '../InboxAIPlayground.jsx';
import {inboxService} from '../inboxService.js';
vi.mock('../inboxService.js',()=>({inboxService:{testContext:vi.fn(),testAI:vi.fn()}}));
afterEach(cleanup);
const props={org:'o',brand:'b',brandName:'Fixture Brand',configuration:{ai_configured:true},onClose:vi.fn()};
const result={simulation:true,mode:'suggest_only',body:{text:'Our verified Brand.',classification:'suggestion_available',sources:[{key:'identity',label:'Brand Identity'}],unresolved_questions:[],handoff_reasons:[]},decision:{kind:'suggestion',text:'Our verified Brand.'},input_tokens:10,output_tokens:5,latency_ms:100,estimated_cost_usd:.0000125,outlet_context:{known:false}};
beforeEach(()=>{vi.clearAllMocks();inboxService.testContext.mockResolvedValue({consent:true,outlets:[],daily_remaining:20});inboxService.testAI.mockResolvedValue({state:'completed',result})});
it('runs bounded multi-turn simulations and never offers a real send action',async()=>{
 render(<InboxAIPlayground {...props}/>);await screen.findByText('20 shared requests left today');
 fireEvent.change(screen.getByRole('textbox',{name:'Test customer message'}),{target:{value:'Which Brand?'}});fireEvent.click(screen.getByRole('button',{name:'Run test'}));
 await screen.findByText('Our verified Brand.');expect(inboxService.testAI.mock.calls[0][0]).toMatchObject({brand:'b',mode:'suggest_only',history:[{kind:'incoming',text:'Which Brand?'}]});
 fireEvent.change(screen.getByRole('textbox',{name:'Test customer message'}),{target:{value:'And tomorrow?'}});fireEvent.click(screen.getByRole('button',{name:'Run test'}));await waitFor(()=>expect(inboxService.testAI).toHaveBeenCalledTimes(2));
 expect(inboxService.testAI.mock.calls[1][0].history).toEqual([{kind:'incoming',text:'Which Brand?'},{kind:'echo',text:'Our verified Brand.'},{kind:'incoming',text:'And tomorrow?'}]);
 expect(screen.queryByRole('button',{name:'Send'})).toBeNull();expect(screen.getByText(/Nothing is sent to Meta/)).toBeTruthy();
});
it('keeps unsent text and reuses one identity after an uncertain network result',async()=>{
 inboxService.testAI.mockRejectedValueOnce(new Error('Network unavailable'));
 render(<InboxAIPlayground {...props}/>);await screen.findByText('20 shared requests left today');
 fireEvent.change(screen.getByRole('textbox',{name:'Test customer message'}),{target:{value:'Hello'}});fireEvent.click(screen.getByRole('button',{name:'Run test'}));await screen.findByRole('alert');
 const id=inboxService.testAI.mock.calls[0][0].requestId;expect(screen.getByRole('textbox').value).toBe('Hello');fireEvent.click(screen.getByRole('button',{name:'Run test'}));await screen.findByText('Our verified Brand.');expect(inboxService.testAI.mock.calls[1][0].requestId).toBe(id);
});
it('does not generate without saved consent or while a request is in flight',async()=>{
 inboxService.testContext.mockResolvedValue({consent:false,outlets:[],daily_remaining:20});render(<InboxAIPlayground {...props}/>);await screen.findByText(/Save Brand AI consent/);expect(screen.getByRole('button',{name:'Run test'}).disabled).toBe(true);expect(inboxService.testAI).not.toHaveBeenCalled();
});
it('blocks rapid submissions and preserves selected simulation mode without saving settings',async()=>{
 let resolve;inboxService.testAI.mockReturnValue(new Promise(done=>{resolve=done}));render(<InboxAIPlayground {...props} initialMode="ai_first"/>);await screen.findByText('20 shared requests left today');
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Brand name ah?'}});const button=screen.getByRole('button',{name:'Run test'});fireEvent.click(button);fireEvent.click(button);expect(inboxService.testAI).toHaveBeenCalledTimes(1);expect(inboxService.testAI.mock.calls[0][0].mode).toBe('ai_first');resolve({state:'completed',result});await screen.findByText('Our verified Brand.');
});
