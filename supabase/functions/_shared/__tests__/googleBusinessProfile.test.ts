import { describe, expect, it, vi } from 'vitest';
import { GoogleBusinessProfile, completePages, readReviewInbox, revokeBusinessGrant } from '../googleBusinessProfile.ts';
import { googleGrant } from '../googleDrive.ts';
import { seal, unseal } from '../metaSecurity.ts';

const location = 'accounts/a/locations/l';
const row = (id = 'r') => ({ name: `${location}/reviews/${id}`, starRating: 'FIVE' as const, createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z', comment: 'Fixture', reviewReply: { comment: 'Owner fixture', updateTime: '2026-10-02T00:00:00Z' } });
const provider = (pages: any[]) => ({ listAccounts: vi.fn(), listLocations: vi.fn(), listReviews: vi.fn().mockImplementation(async () => pages.shift()) });
describe('Google Business Profile read boundary', () => {
 it('uses fixed GET hosts, canonical source identity, account/location API names and page size 50', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ accounts: [{ name: 'accounts/a', accountName: 'Fixture account' }] }))
   .mockResolvedValueOnce(Response.json({ locations: [{ name: 'locations/l', title: 'Fixture location' }] }))
   .mockResolvedValueOnce(Response.json({ reviews: [{ ...row(), name: undefined, reviewId: 'r' }] }));
  const p = new GoogleBusinessProfile('server-token', fetcher);
  expect((await p.listAccounts()).accounts[0].displayName).toBe('Fixture account');
  expect((await p.listLocations('accounts/a')).locations[0].name).toBe(location);
  expect((await p.listReviews(location)).reviews[0]).toMatchObject(row());
  expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET' && options.redirect === 'error')).toBe(true);
  expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('pageSize')).toBe('50');
  await expect(p.read('evil.example', 'x')).rejects.toThrow('invalid_host');
  await expect(p.listReviews('https://evil.example')).rejects.toThrow('invalid_resource');
 });
 it('walks 50 + 16 pages and deduplicates without losing existing owner replies', async () => {
  const rows = Array.from({ length: 66 }, (_, i) => row(String(i)));
  const p = provider([{ reviews: rows.slice(0,50), nextPageToken: 'next' }, { reviews: [...rows.slice(50), rows[0]] }]);
  const found = await readReviewInbox(p,location);
  expect(found).toHaveLength(66); expect(found[0].reviewReply?.comment).toBe('Owner fixture');
  expect(p.listReviews).toHaveBeenNthCalledWith(2,location,'next');
 });
 it('retains the latest reply revision while preserving review creation time', async () => {
  const old = row(), next = { ...row(), reviewReply: { comment: 'Changed reply', updateTime: '2026-10-03T00:00:00Z' } };
  expect(await readReviewInbox(provider([{ reviews: [old,next] }]),location)).toEqual([next]);
 });
 it('rejects partial pages, repeated tokens, foreign locations and conflicting same revisions', async () => {
  await expect(completePages(async () => ({ rows: [], nextPageToken: 'repeat' }))).rejects.toThrow('repeated_page');
  const failed = provider([]); failed.listReviews.mockRejectedValue(new Error('Provider failure'));
  await expect(readReviewInbox(failed,location)).rejects.toThrow('Provider failure');
  await expect(readReviewInbox(provider([{ reviews: [{ ...row(), name: 'accounts/x/locations/y/reviews/r' }] }]),location)).rejects.toThrow('invalid_review');
  await expect(readReviewInbox(provider([{ reviews: [row(),{ ...row(),comment: 'conflict' }] }]),location)).rejects.toThrow('conflicting_review');
  await expect(readReviewInbox(provider([{ reviews: [row(),{ ...row(),createTime: '2026-09-01T00:00:00Z' }] }]),location)).rejects.toThrow('invalid_review_creation');
 });
 it('requests refresh server-side and revokes only at the official OAuth endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: 'new', expires_in: 3600 }));
  expect(await googleGrant({ grant_type: 'refresh_token', refresh_token: 'refresh' },'id','secret',fetcher)).toMatchObject({ access_token: 'new' });
  expect(String(fetcher.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
  expect(fetcher.mock.calls[0][1].body.get('refresh_token')).toBe('refresh');
  await revokeBusinessGrant('refresh',fetcher);
  expect(String(fetcher.mock.calls[1][0])).toBe('https://oauth2.googleapis.com/revoke');
  expect(fetcher.mock.calls[1][1].body.get('token')).toBe('refresh');
  await expect(revokeBusinessGrant('refresh',async () => new Response('',{status:503}))).rejects.toThrow('revocation_pending');
 });
 it('identifies the exact 429 service/request without retrying',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('',{status:429}));
  const p=new GoogleBusinessProfile('server-token',fetcher);
  await expect(p.listReviews(location)).rejects.toMatchObject({code:'google_rate_limited',status:429,service:'mybusiness.googleapis.com',request:'GET /v4/accounts/a/locations/l/reviews'});
  expect(fetcher).toHaveBeenCalledTimes(1);
  const oauth=vi.fn().mockResolvedValue(Response.json({error:'rate_limited'},{status:429}));
  await expect(googleGrant({grant_type:'refresh_token',refresh_token:'fixture'},'id','secret',oauth,false)).rejects.toMatchObject({code:'google_rate_limited',status:429});
  expect(oauth).toHaveBeenCalledTimes(1);
 });
 it('encrypts token/cache material with generation and mapping binding, and supports key rotation', async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const sealed = await seal({ refresh_token:'private' },key,'google-business:token:1');
  expect(JSON.stringify(sealed)).not.toContain('private');
  expect(await unseal(sealed,['',key],'google-business:token:1')).toEqual({refresh_token:'private'});
  await expect(unseal(sealed,[key],'google-business:token:2')).rejects.toThrow();
 });
});
