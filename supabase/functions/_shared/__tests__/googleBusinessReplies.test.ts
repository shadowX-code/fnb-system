import { describe,expect,it,vi } from 'vitest';
import { runGoogleOwnerReplyMockVerification } from '../../../../qa/staging/googleOwnerReplyMockCases.ts';
import { GoogleOwnerReplies, replyText, reviewResource, executeOwnerReply } from '../googleBusinessReplies.ts';
describe('Official owner-reply boundary',()=>{
 it('runs multilingual publish/update, uncertain write reconciliation, conflicts, permissions, 429 and audit acknowledgement failures',async()=>{
  const result=await runGoogleOwnerReplyMockVerification();expect(result.passed).toBe(12);expect(result.realGoogleWrites).toBe(0);
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
