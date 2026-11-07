import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import AgentActivityTimeline from './AgentActivityTimeline.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{actionRequests:vi.fn()}}));
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();externalAgentService.actionRequests.mockResolvedValue([]);});afterEach(cleanup);
const agent={id:'agent',can_manage:false};
const read=id=>({id,occurred_at:'2026-11-01T08:00:00Z',outcome:'success',tool:'query_factory_resources',resource_actions:[{business_module:'factory_mesti_cleaning',resource:'occurrences',action:'list'}]});
it('preserves read-only access and paginates every returned read without requesting mutation evidence',()=>{
 render(<AgentActivityTimeline agent={agent} detail={{access_events:Array.from({length:25},(_,i)=>read(i))}} onRefresh={vi.fn()}/>);
 expect(screen.getAllByText('Read succeeded')).toHaveLength(20);
 fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getAllByText('Read succeeded')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button',{name:'Previous'}));expect(screen.getAllByText('Read succeeded')).toHaveLength(20);
 expect(externalAgentService.actionRequests).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/Approve|Confirm/})).toBeNull();
});
it('distinguishes a receipt-backed commit from pending execution and keeps diagnostics expandable',async()=>{
 const row={identity_id:'agent',request_id:'req',action:'area_cleaning.verify',status:'completed',expected_version:'source',input:{result:'verified'},receipt:{status:'completed',request_id:'req',action:'area_cleaning.verify',actor:{identity_id:'agent'},before_version:'source',target_id:'record',completed_at:'2026-11-01T08:00:00Z'}};
 externalAgentService.actionRequests.mockResolvedValue([row,{...row,request_id:'pending',status:'awaiting_confirmation',queue_state:'awaiting_execution',receipt:null,requested_at:'2026-11-01T08:00:00Z'}]);
 render(<AgentActivityTimeline agent={{...agent,can_manage:true}} detail={{}} onRefresh={vi.fn()}/>);
 expect(await screen.findByText('Area Cleaning verified')).toBeTruthy();expect(screen.getAllByText('Completed')).toHaveLength(1);
 expect(screen.getByText('Awaiting Agent Execution')).toBeTruthy();expect(screen.getByText('Record reference: record')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Open Cleaning of Area records'}).getAttribute('href')).toBe('/factory/mesti/cleaning-of-area');
 expect(screen.getAllByText('Diagnostics & evidence')).toHaveLength(2);
});
it('refreshes through the existing authority without background polling',async()=>{
 const refresh=vi.fn().mockResolvedValue();
 render(<AgentActivityTimeline agent={{...agent,can_manage:true}} detail={{}} onRefresh={refresh}/>);
 await screen.findByText('No activity matches these filters.');
 fireEvent.click(screen.getByRole('button',{name:'Refresh activity'}));
 expect(refresh).toHaveBeenCalledTimes(1);
});

it('resolves HR transport module IDs through canonical navigation without changing receipts',async()=>{
 const receipt={status:'completed',request_id:'hr',action:'hr_legal_entity.update',actor:{identity_id:'agent'},before_version:'source',target_id:'company',completed_at:'2026-11-07T01:00:00Z'};
 externalAgentService.actionRequests.mockResolvedValue([{identity_id:'agent',request_id:'hr',action:'hr_legal_entity.update',status:'completed',expected_version:'source',input:{},receipt}]);
 render(<AgentActivityTimeline agent={{...agent,can_manage:true}} detail={{access_events:[{id:1,tool:'query_product_sales_analytics',outcome:'success',occurred_at:'2026-11-07T01:00:00Z'}]}} onRefresh={vi.fn()}/>);
 expect(await screen.findByText('Legal Entity updated')).toBeTruthy();
 expect(screen.getByRole('link',{name:'Open Legal Entities records'}).getAttribute('href')).toBe('/people/legal-entities');
 expect(screen.getByText('Read Product Analytics records')).toBeTruthy();
});
