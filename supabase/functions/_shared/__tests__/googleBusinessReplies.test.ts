import { describe,expect,it,vi } from 'vitest';
import { runGoogleOwnerReplyMockVerification } from '../../../../qa/staging/googleOwnerReplyMockCases.ts';
import { GoogleOwnerReplies, replyText, reviewResource, executeOwnerReply, reconcileOwnerReply } from '../googleBusinessReplies.ts';
describe('Official owner-reply boundary',()=>{
 it('runs multilingual publish/update, uncertain write reconciliation, conflicts, permissions, 429 and audit acknowledgement failures',async()=>{
  const result=await runGoogleOwnerReplyMockVerification();expect(result.passed).toBe(13);expect(result.realGoogleWrites).toBe(0);
 });
 it('validates UTF-8 limits and mapped review identity',()=>{
  expect(replyText('你好 Terima kasih')).toBe('你好 Terima kasih');expect(()=>replyText(' ')).toThrow('invalid_reply_text');expect(()=>replyText('中'.repeat(1366))).toThrow('invalid_reply_text');
  expect(()=>reviewResource('accounts/a/locations/other/reviews/r','accounts/a/locations/l')).toThrow('invalid_review');expect(()=>reviewResource('https://evil.example/reviews/r','https://evil.example')).toThrow('invalid_resource');
 });
 it('does not call the provider for an active lease and never writes during status-only reconciliation',async()=>{
  const provider={getReview:vi.fn(),updateReply:vi.fn()},finish=vi.fn();
  const result=await executeOwnerReply({claim:async()=>({id:'id',status:'sending',claimed:false}),provider,finish,beforeWrite:async()=>{},intent:async()=>null});
  expect(result.status).toBe('sending');expect(provider.getReview).not.toHaveBeenCalled();
 });
 it('treats malformed successful Google responses as uncertain, not published evidence',async()=>{
  const transport=vi.fn().mockResolvedValue(Response.json({comment:'Different reply',updateTime:'invalid'}));
  await expect(new GoogleOwnerReplies('fixture',transport).updateReply('accounts/a/locations/l/reviews/r','Desired')).rejects.toMatchObject({code:'reply_outcome_uncertain'});expect(transport).toHaveBeenCalledTimes(1);
 });
});

describe('Confirmed reply read reconciliation',()=>{
 const review={name:'accounts/a/locations/l/reviews/r',starRating:'FIVE' as const,createTime:'2026-05-14T17:23:34Z',updateTime:'2026-05-14T17:23:34Z'};
 const confirmed={comment:'Thanks',updateTime:'2026-10-14T13:47:19.177320Z'};
 it('preserves accepted evidence across absent and older readbacks, blocking another write',()=>{
  for(const remote of [review,{...review,reviewReply:{comment:'Old',updateTime:'2026-10-14T13:46:00Z'}}]){
   expect(reconcileOwnerReply(remote,confirmed)).toMatchObject({reply_sync_pending:true,review:{reviewReply:confirmed}});
  }
 });
 it('accepts matching readback and genuine newer external edits without overwriting them',()=>{
  expect(reconcileOwnerReply({...review,reviewReply:confirmed},confirmed).reply_sync_pending).toBe(false);
  const newer={comment:'Remote updated',updateTime:'2026-10-14T13:48:00Z'};
  expect(reconcileOwnerReply({...review,reviewReply:newer},confirmed)).toMatchObject({reply_sync_pending:false,review:{reviewReply:newer}});
  expect(reconcileOwnerReply(review)).toEqual({review,reply_sync_pending:false});
 });
 it('cannot PUT against a lagging read even with a stale client hash',async()=>{
  const provider={getReview:vi.fn().mockRejectedValue(new (await import('../googleBusinessProfile.ts')).BusinessProfileError('reply_readback_pending',409)),updateReply:vi.fn()};
  const finish=vi.fn();const result=await executeOwnerReply({claim:async()=>({id:'id',claimed:true,status:'ready',review_name:review.name}),provider,finish,beforeWrite:async()=>{},intent:async()=>null});
  expect(result).toMatchObject({status:'rejected',code:'reply_readback_pending'});expect(provider.updateReply).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledTimes(1);
 });
 it('does not turn genuine Google read errors into an absent reply',async()=>{
  const transport=vi.fn().mockResolvedValue(new Response('Unavailable',{status:503}));
  await expect(new GoogleOwnerReplies('fixture',transport).getReview(review.name)).rejects.toMatchObject({code:'google_unavailable'});
 });
});
