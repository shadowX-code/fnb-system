import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
const mocks=vi.hoisted(()=>({detail:vi.fn(),reply:vi.fn(),replyStatus:vi.fn()}));
vi.mock('../../services/googleBusinessService.js',()=>({googleBusinessService:mocks}));
vi.mock('../../services/googleReplyReconciliation.js',async original=>{const actual=await original();return {readReconciledReply:(read,current)=>actual.readReconciledReply(read,current,async()=>{})};});
import GoogleReviewDetail from '../../components/GoogleReviewDetail.jsx';
const review={name:'accounts/a/locations/l/reviews/r',starRating:'FOUR',comment:'Fixture review',reviewer:{displayName:'Fixture reviewer'},createTime:'2026-10-01T00:00:00Z',updateTime:'2026-10-01T00:00:00Z'};
const basis={generation:2,mapping:{name:'accounts/a/locations/l',revision:'revision'}};
const detail={review,can_reply:true,generation:2,revision:'revision',expectedHash:'a'.repeat(64),history:[]};
const draft='Thank you. 谢谢您的反馈。 Terima kasih.';
const remoteReply={comment:draft,updateTime:'2026-10-14T12:00:00Z'};
const onConfirmed=vi.fn().mockResolvedValue(undefined);
const mount=()=>render(<GoogleReviewDetail review={review} outletId="outlet" outletName="Fixture outlet" basis={basis} onClose={vi.fn()} onConfirmed={onConfirmed}/>);
const write=async()=>{fireEvent.change(await screen.findByRole('textbox',{name:'Your reply'}),{target:{value:draft}});fireEvent.click(screen.getByRole('button',{name:'Publish Reply',exact:true}));};
const confirm=()=>fireEvent.click(within(screen.getByRole('dialog',{name:'Publish Reply',exact:true})).getByRole('button',{name:'Publish Reply',exact:true}));
beforeEach(()=>{Object.values(mocks).forEach(mock=>mock.mockReset());onConfirmed.mockClear();mocks.detail.mockResolvedValue(detail);mocks.reply.mockImplementation(async()=>{mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply},expectedHash:'b'.repeat(64)});return {status:'confirmed',remoteReply,expectedHash:'b'.repeat(64)};});});
afterEach(cleanup);
describe('Review Detail owner reply workflow',()=>{
 it('requires explicit confirmation and retains multilingual text when confirmation is cancelled',async()=>{
  mount();await write();expect(mocks.reply).not.toHaveBeenCalled();expect(within(screen.getByRole('dialog',{name:'Publish Reply',exact:true})).getByText(draft)).not.toBeNull();
  fireEvent.click(within(screen.getByRole('dialog',{name:'Publish Reply',exact:true})).getByRole('button',{name:'Cancel'}));expect(screen.getByRole('textbox').value).toBe(draft);
 });
 it('publishes only the exact confirmed intent and refreshes the canonical projection',async()=>{
  mount();await write();confirm();await screen.findByText('Reply synced.');
  await waitFor(()=>expect(onConfirmed).toHaveBeenCalledTimes(1));expect(mocks.reply).toHaveBeenCalledWith('outlet',expect.objectContaining({review:review.name,comment:draft,expectedHash:'a'.repeat(64),generation:2,revision:'revision'}));
  await screen.findByText('Replied');expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(true);
 });
 it('edits an existing owner reply through the same confirmed detail workflow',async()=>{
  mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:{comment:'Existing reply',updateTime:'2026-10-02T00:00:00Z'}}});
  mount();const field=await screen.findByRole('textbox',{name:'Your reply'});expect(field.value).toBe('Existing reply');
  fireEvent.change(field,{target:{value:draft}});fireEvent.click(screen.getByRole('button',{name:'Update Reply'}));expect(mocks.reply).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog',{name:'Update Reply'})).getByRole('button',{name:'Update Reply'}));await screen.findByText('Reply synced.');
  expect(mocks.reply).toHaveBeenCalledWith('outlet',expect.objectContaining({existingReply:true,comment:draft}));
 });
 it('retains the draft after permission rejection',async()=>{
  mocks.reply.mockResolvedValue({status:'rejected',code:'google_access_denied'});mount();await write();confirm();
  expect((await screen.findByRole('alert')).textContent).toContain('Google denied');expect(screen.getByRole('textbox').value).toBe(draft);expect(screen.getByRole('textbox').disabled).toBe(false);
 });
 it('reconciles an uncertain submission without sending the draft again',async()=>{
  mocks.reply.mockResolvedValue({status:'uncertain',code:'reply_outcome_uncertain'});
  mocks.replyStatus.mockImplementation(async()=>{mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply}});return {status:'confirmed',remoteReply,expectedHash:'b'.repeat(64)};});
  mount();await write();confirm();await screen.findByRole('button',{name:'Check Status'});expect(screen.getByRole('textbox').value).toBe(draft);expect(screen.getByRole('textbox').disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Check Status'}));await screen.findByText('Reply synced.');expect(mocks.reply).toHaveBeenCalledTimes(1);expect(mocks.replyStatus).toHaveBeenCalledWith('outlet',mocks.reply.mock.calls[0][1].id);
 });
 it('blocks duplicate final actions while the request is pending',async()=>{
  let resolve;mocks.reply.mockImplementation(()=>new Promise(done=>{resolve=done;}));mount();await write();confirm();
  expect(screen.getByRole('button',{name:'Working…'}).disabled).toBe(true);expect(screen.getByRole('button',{name:'Close',exact:true}).disabled).toBe(true);expect(mocks.reply).toHaveBeenCalledTimes(1);
  resolve({status:'rejected',code:'reply_rejected'});await screen.findByRole('alert');
 });
 it('does not grant publishing to view-only Admin',async()=>{
  mocks.detail.mockResolvedValue({...detail,can_reply:false});mount();await screen.findByText('Your access allows viewing only.');expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('button',{name:'Publish Reply'})).toBeNull();expect(mocks.reply).not.toHaveBeenCalled();
 });
 it('preserves a draft through conflict and explicit remote reload before a new intent',async()=>{
  mocks.reply.mockResolvedValue({status:'conflict',code:'reply_changed'});mount();await write();confirm();await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'Publish Reply'}).disabled).toBe(true);
  mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:{comment:'Other Admin reply',updateTime:'2026-10-14T12:01:00Z'}},expectedHash:'c'.repeat(64)});
  fireEvent.click(screen.getByRole('button',{name:'Reload reply'}));await screen.findByText('Other Admin reply');expect(screen.getByRole('textbox').value).toBe(draft);expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(false);
 });
 it('shows Google moderation pending instead of claiming a public reply was published',async()=>{
  const pending={...remoteReply,reviewReplyState:'PENDING'};mocks.reply.mockImplementation(async()=>{mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:pending}});return {status:'confirmed',remoteReply:pending};});
  mount();await write();confirm();await screen.findByText('Reply submitted. Pending Google review.');expect(screen.queryByText('Reply synced.')).toBeNull();await screen.findByText('Replied · Pending Google review');
 });
 it('applies the official byte limit to non-Latin text without rewriting it',async()=>{
  mount();const field=await screen.findByRole('textbox',{name:'Your reply'});fireEvent.change(field,{target:{value:'中'.repeat(1366)}});expect(field.value).toHaveLength(1366);expect(screen.getByRole('button',{name:'Publish Reply'}).disabled).toBe(true);
 });
});

describe('Reply readback freshness',()=>{
 it('retains confirmed reply text and blocks publication until remote read catches up',async()=>{
  mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply},reply_sync_pending:true,expectedHash:null});
  mount();const field=await screen.findByRole('textbox',{name:'Your reply'});expect(field.value).toBe(draft);
  expect(screen.getByText('Replied')).not.toBeNull();expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(true);
  fireEvent.change(field,{target:{value:'New unsent draft'}});expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(true);
  mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply}});fireEvent.click(screen.getByRole('button',{name:'Retry sync'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(false));expect(field.value).toBe('New unsent draft');expect(mocks.reply).not.toHaveBeenCalled();
 });
 it('does not label a failed read as Not Replied or leave publication enabled',async()=>{
  mount();await write();fireEvent.click(within(screen.getByRole('dialog',{name:'Publish Reply'})).getByRole('button',{name:'Cancel'}));
  mocks.reply.mockResolvedValue({status:'rejected',code:'google_access_denied'});fireEvent.click(screen.getByRole('button',{name:'Publish Reply'}));confirm();await screen.findByRole('alert');
  mocks.detail.mockRejectedValue(new Error('Google read unavailable'));fireEvent.click(screen.getByRole('button',{name:'Reload reply'}));await screen.findByText('Google read unavailable');
  expect(screen.queryByText('Not Replied')).toBeNull();expect(screen.getByText('Reply unavailable')).not.toBeNull();expect(screen.getByRole('textbox').value).toBe(draft);expect(screen.queryByRole('button',{name:'Publish Reply'})).toBeNull();
 });
});

describe('Post-write automatic reconciliation',()=>{
 it('retries stale GETs, then shows only synced success and keeps one write',async()=>{
  const pending={...detail,review:{...review,reviewReply:remoteReply},reply_sync_pending:true,expectedHash:null};
  mocks.detail.mockResolvedValueOnce(detail).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply}});
  mocks.reply.mockResolvedValue({status:'confirmed',remoteReply});mount();await write();confirm();await screen.findByText('Reply synced.');
  expect(mocks.detail).toHaveBeenCalledTimes(4);expect(mocks.reply).toHaveBeenCalledTimes(1);expect(screen.queryByText('Sync pending')).toBeNull();expect(screen.queryByText('Syncing reply…')).toBeNull();
 });
 it('caps reads, shows one Sync pending state, and manually reconciles without another write',async()=>{
  const pending={...detail,review:{...review,reviewReply:remoteReply},reply_sync_pending:true,expectedHash:null};
  mocks.detail.mockResolvedValueOnce(detail).mockResolvedValue(pending);mocks.reply.mockResolvedValue({status:'confirmed',remoteReply});
  mount();await write();confirm();await screen.findByRole('button',{name:'Retry sync'});expect(mocks.detail).toHaveBeenCalledTimes(5);expect(screen.getAllByText('Sync pending')).toHaveLength(1);expect(screen.queryByText('Reply synced.')).toBeNull();
  const field=screen.getByRole('textbox',{name:'Your reply'});fireEvent.change(field,{target:{value:'Unsent draft'}});expect(screen.getByRole('button',{name:'Update Reply'}).disabled).toBe(true);
  mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:remoteReply}});fireEvent.click(screen.getByRole('button',{name:'Retry sync'}));await screen.findByText('Reply synced.');expect(screen.getByRole('textbox',{name:'Your reply'}).value).toBe('Unsent draft');expect(mocks.reply).toHaveBeenCalledTimes(1);
 });
 it('keeps confirmed evidence on read failure and does not retry provider errors',async()=>{
  mocks.reply.mockResolvedValue({status:'confirmed',remoteReply});mocks.detail.mockResolvedValueOnce(detail).mockRejectedValue(new Error('Google rate limit (429)'));
  mount();await write();confirm();await screen.findByText('Sync pending');expect(screen.getByRole('alert').textContent).toContain('429');expect(screen.getByText(draft)).not.toBeNull();expect(screen.queryByText('Reply synced.')).toBeNull();expect(mocks.detail).toHaveBeenCalledTimes(2);expect(mocks.reply).toHaveBeenCalledTimes(1);
 });
});

 it('does not expose Edit Reply to a Publish-only reader',async()=>{
 mocks.detail.mockResolvedValue({...detail,review:{...review,reviewReply:{comment:'Existing reply',updateTime:'2026-10-15T00:00:00Z'}},can_reply:true,can_publish_reply:true,can_edit_reply:false});
 render(<GoogleReviewDetail review={review} outletId="outlet" basis={basis} onClose={()=>{}} onConfirmed={async()=>{}}/>);
 await screen.findByText('Existing reply');expect(screen.queryByRole('button',{name:'Update Reply'})).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();
 });

 it('does not expose Publish Reply to an Edit-only reader when no reply exists',async()=>{
 mocks.detail.mockResolvedValue({...detail,can_reply:true,can_publish_reply:false,can_edit_reply:true});mount();
 await screen.findByText('Your access allows viewing only.');expect(screen.queryByRole('button',{name:'Publish Reply',exact:true})).toBeNull();
 });
