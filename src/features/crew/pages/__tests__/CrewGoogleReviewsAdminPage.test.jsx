import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ context:vi.fn(),sync:vi.fn(),map:vi.fn(),authorize:vi.fn(),disconnect:vi.fn(),discover:vi.fn(),legacy:vi.fn(),save:vi.fn(),history:vi.fn() }));
vi.mock('../../services/googleBusinessService.js',()=>({googleBusinessService:mocks}));
vi.mock('../../../../services/crewService.js',()=>({crewService:{googleReviewsAdminContext:mocks.legacy,setGoogleMonthlyTarget:mocks.save,googleTargetHistory:mocks.history}}));
import CrewGoogleReviewsAdminPage from '../CrewGoogleReviewsAdminPage.jsx';
const outlet={id:'outlet-1',name:'Friends Corner',is_active:true};
const context={configured:true,api_status:'available',connection_status:'disconnected',can_manage:true,generation:0,reviews:[],sync_status:'awaiting_sync',scoring_enabled:false};
const auth={hasPermission:()=>true};
beforeEach(()=>{Object.values(mocks).forEach(m=>m.mockReset());mocks.context.mockResolvedValue(context);mocks.legacy.mockResolvedValue({positive_target:null,target_locked:false});mocks.history.mockResolvedValue({rows:[]});mocks.save.mockResolvedValue({changed:true});mocks.sync.mockResolvedValue({ok:true});});
afterEach(cleanup);
const mount=()=>render(<CrewGoogleReviewsAdminPage auth={auth} store={{outlets:[outlet]}}/>);
describe('Phase 1 Google reputation workspace',()=>{
 it('shows disconnected state without fabricated reviews or performance metrics',async()=>{
  mount();expect(await screen.findByText('Google Business Profile is not connected')).not.toBeNull();
  expect(screen.getByRole('button',{name:'Sync reviews'}).disabled).toBe(true);
  expect(screen.queryByText('Average Rating')).toBeNull();expect(screen.queryByText('Negative Rate')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));expect(screen.getByRole('button',{name:'Connect Google'}).disabled).toBe(false);
 });
 it('keeps connection and mapping controls unavailable to scoped read-only users',async()=>{
  mocks.context.mockResolvedValue({...context,can_manage:false});mount();await screen.findByText('Google Business Profile is not connected');
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));expect(screen.getByRole('button',{name:'Connect Google'}).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'Save mapping'}).disabled).toBe(true);
 });
 it('renders authentic source and existing owner replies, with rating/reply/search filters',async()=>{
  mocks.context.mockResolvedValue({...context,connection_status:'connected',sync_status:'complete',mapping:{name:'accounts/a/locations/l',title:'Fixture location',revision:'r'},cache_expires_at:new Date(Date.now()+3600000).toISOString(),reviews:[
   {name:'accounts/a/locations/l/reviews/1',starRating:'FIVE',createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z',comment:'Excellent fixture',reviewer:{displayName:'Test reviewer'},reviewReply:{comment:'Thank you fixture',updateTime:'2026-10-02T00:00:00Z'}},
   {name:'accounts/a/locations/l/reviews/2',starRating:'TWO',createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z',comment:'Other fixture'}]});
  mount();expect(await screen.findByText('Thank you fixture')).not.toBeNull();expect(screen.getByText('accounts/a/locations/l/reviews/1')).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Search'),{target:{value:'Thank you'}});expect(screen.queryByText('Other fixture')).toBeNull();
  fireEvent.change(screen.getByLabelText('Search'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Owner reply',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Without owner reply'}));
  expect(screen.queryByText('Thank you fixture')).toBeNull();expect(screen.getByText('Other fixture')).not.toBeNull();
 });
 it('surfaces exact sync rejection and prevents duplicate sync submits',async()=>{
  mocks.context.mockResolvedValue({...context,connection_status:'connected',mapping:{name:'accounts/a/locations/l'}});
  mocks.sync.mockRejectedValue(new Error('Google rate limit (429): mybusiness.googleapis.com · GET /v4/accounts/a/locations/l/reviews.'));
  mount();await screen.findByText('Sync this outlet’s Google Reviews');fireEvent.click(screen.getByRole('button',{name:'Sync reviews'}));
  expect((await screen.findByRole('alert')).textContent).toContain('mybusiness.googleapis.com');expect(mocks.sync).toHaveBeenCalledTimes(1);
 });
 it('reads canonical sync failure state without retrying the Google request or keeping a false up-to-date status',async()=>{
  const connected={...context,connection_status:'connected',mapping:{name:'accounts/a/locations/l'}};
  mocks.context.mockResolvedValueOnce({...connected,sync_status:'complete'}).mockResolvedValue({...connected,sync_status:'error'});
  mocks.sync.mockRejectedValue(new Error('Google unavailable'));
  mount();await screen.findByText('Google Review Inbox is up to date');fireEvent.click(screen.getByRole('button',{name:'Sync reviews'}));
  await screen.findByText('Review sync needs attention');expect(mocks.sync).toHaveBeenCalledTimes(1);expect(mocks.context).toHaveBeenCalledTimes(2);
 });
 it('preserves audited target configuration while scoring is disabled',async()=>{
  mocks.history.mockResolvedValue({rows:[{id:1,old_target:10,new_target:15,changed_at:'2026-09-01T00:00:00Z'}]});mount();await screen.findByText('Google Business Profile is not connected');
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));expect(await screen.findByText('10 → 15 positive reviews')).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Positive reviews'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'Save target'}));
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(outlet.id,expect.stringMatching(/^\d{4}-\d{2}-01$/),3));
 });
});
