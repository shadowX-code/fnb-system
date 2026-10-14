import type { GoogleReviewRecord, GoogleReviewsProvider } from './googleReviewsContract.ts';
import { driveFetch, DriveError } from './googleDrive.ts';

export const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export class BusinessProfileError extends Error {
 constructor(public code: string, public status = 400, public service?: string, public request?: string) { super(code); }
}
export function resource(value: string, kind: 'account' | 'location') {
 const pattern = kind === 'account' ? /^accounts\/[A-Za-z0-9_-]+$/ : /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/;
 if (!pattern.test(value)) throw new BusinessProfileError('invalid_resource');
 return value;
}
// Business endpoints are GET-only and fixed here; client URLs are never fetched.
export class GoogleBusinessProfile implements GoogleReviewsProvider {
 constructor(private token: string, private transport: typeof fetch = fetch, private deadline = Date.now() + 90000) {}
 async read(host: string, path: string, params: Record<string, string> = {}) {
  if (!['mybusinessaccountmanagement.googleapis.com','mybusinessbusinessinformation.googleapis.com','mybusiness.googleapis.com'].includes(host)) throw new BusinessProfileError('invalid_host');
  const url = new URL(`https://${host}/${path}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const response = await driveFetch(this.transport, url, { method: 'GET', headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error' }, this.deadline, false);
  if (response.status === 429) throw new BusinessProfileError('google_rate_limited',429,host,`GET /${path}`);
  if (!response.ok) throw new BusinessProfileError(response.status === 401 ? 'reconnect_required' : response.status === 403 ? 'google_access_denied' : 'google_unavailable', response.status,host,`GET /${path}`);
  return response.json();
 }
 async listAccounts(pageToken = '') {
  const data = await this.read('mybusinessaccountmanagement.googleapis.com', 'v1/accounts', { pageToken, pageSize: '20' });
  return { accounts: (data.accounts || []).map((a: any) => ({ name: resource(a.name, 'account'), displayName: a.accountName })), nextPageToken: data.nextPageToken };
 }
 async listLocations(account: string, pageToken = '') {
  const data = await this.read('mybusinessbusinessinformation.googleapis.com', `v1/${resource(account, 'account')}/locations`, { readMask: 'name,title,storeCode', pageSize: '100', pageToken });
  return { locations: (data.locations || []).map((l: any) => ({ name: resource(`${account}/${l.name}`, 'location'), title: l.title })), nextPageToken: data.nextPageToken };
 }
 async listReviews(location: string, pageToken = '') {
  const data = await this.read('mybusiness.googleapis.com', `v4/${resource(location, 'location')}/reviews`, { pageSize: '50', pageToken });
  return { reviews: (data.reviews || []).map((r: any) => ({ name: r.name || `${location}/reviews/${r.reviewId}`, createTime: r.createTime, updateTime: r.updateTime, starRating: r.starRating, ...(r.comment ? { comment: r.comment } : {}), ...(r.reviewer ? { reviewer: r.reviewer } : {}), ...(r.reviewReply ? { reviewReply: r.reviewReply } : {}) })), nextPageToken: data.nextPageToken, averageRating: data.averageRating, totalReviewCount: data.totalReviewCount };
 }
}
export async function completePages<T>(read: (token?: string) => Promise<{ rows: T[]; nextPageToken?: string }>) {
 const rows: T[] = [], seen = new Set<string>(); let token: string | undefined;
 do {
  if (seen.size >= 100) throw new BusinessProfileError('sync_limit');
  const page = await read(token);
  if (!Array.isArray(page.rows)) throw new BusinessProfileError('invalid_page');
  rows.push(...page.rows); if (rows.length > 5000) throw new BusinessProfileError('sync_limit');
  token = page.nextPageToken || undefined;
  if (token && seen.has(token)) throw new BusinessProfileError('repeated_page');
  if (token) seen.add(token);
 } while (token);
 return rows;
}
// Reconciliation is identity-based; it neither aggregates ratings nor calls Performance.
export async function readReviewInbox(provider: GoogleReviewsProvider, location: string) {
 resource(location, 'location');
 const aggregates: { location: string; averageRating?: number; totalReviewCount: number }[] = [];
 const rows = await completePages<GoogleReviewRecord>(async token => {
  const page = await provider.listReviews(location, token);
  if (page.totalReviewCount !== undefined || page.averageRating !== undefined) {
   if (!Number.isSafeInteger(page.totalReviewCount) || page.totalReviewCount! < 0
    || page.averageRating !== undefined && (!Number.isFinite(page.averageRating) || page.averageRating < 1 || page.averageRating > 5) && !(page.totalReviewCount === 0 && page.averageRating === 0)) throw new BusinessProfileError('invalid_review_aggregate');
   const next = { location, totalReviewCount: page.totalReviewCount!, ...(page.averageRating ? { averageRating: page.averageRating } : {}) };
   const aggregate = aggregates[0];
   if (aggregate && (aggregate.totalReviewCount !== next.totalReviewCount || aggregate.averageRating !== next.averageRating)) throw new BusinessProfileError('changed_review_aggregate');
   if (!aggregate) aggregates.push(next);
  }
  return { rows: page.reviews, nextPageToken: page.nextPageToken };
 });
 const unique = new Map<string, GoogleReviewRecord>();
 for (const row of rows) {
  if (!row.name.startsWith(`${location}/reviews/`) || !/^[A-Za-z0-9_-]+$/.test(row.name.slice(`${location}/reviews/`.length)) || !['ONE','TWO','THREE','FOUR','FIVE'].includes(row.starRating)
   || typeof row.createTime !== 'string' || typeof row.updateTime !== 'string' || row.comment !== undefined && typeof row.comment !== 'string'
   || row.reviewer && (typeof row.reviewer !== 'object' || row.reviewer.displayName !== undefined && typeof row.reviewer.displayName !== 'string' || row.reviewer.profilePhotoUrl !== undefined && typeof row.reviewer.profilePhotoUrl !== 'string')
   || !Number.isFinite(Date.parse(row.createTime)) || !Number.isFinite(Date.parse(row.updateTime)) || Date.parse(row.updateTime) < Date.parse(row.createTime)
   || row.reviewReply && (typeof row.reviewReply.comment !== 'string' || !Number.isFinite(Date.parse(row.reviewReply.updateTime)))) throw new BusinessProfileError('invalid_review');
  const old = unique.get(row.name);
  if (old && old.createTime !== row.createTime) throw new BusinessProfileError('invalid_review_creation');
  const revision = Math.max(Date.parse(row.updateTime), Date.parse(row.reviewReply?.updateTime || row.updateTime));
  const previous = old && Math.max(Date.parse(old.updateTime), Date.parse(old.reviewReply?.updateTime || old.updateTime));
  if (previous === revision && JSON.stringify(old) !== JSON.stringify(row)) throw new BusinessProfileError('conflicting_review');
  if (!old || revision > previous!) unique.set(row.name, row);
 }
 const aggregate = aggregates[0] || null;
 if (aggregate && aggregate.totalReviewCount !== unique.size) throw new BusinessProfileError('incomplete_review_dataset');
 return { version: 1, reviews: [...unique.values()], googleAggregate: aggregate };
}
// Old encrypted array caches remain readable until their existing expiry; they have no official aggregate.
export function reviewInboxPayload(value: any, location: string) {
 if (Array.isArray(value)) return { reviews: value, googleAggregate: null };
 if (value?.version !== 1 || !Array.isArray(value.reviews) || value.googleAggregate && value.googleAggregate.location !== location) throw new BusinessProfileError('invalid_inbox_cache');
 return { reviews: value.reviews, googleAggregate: value.googleAggregate || null };
}
export async function revokeBusinessGrant(token: string, transport: typeof fetch = fetch) {
 const response = await transport('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }), redirect: 'error', signal: AbortSignal.timeout(15000) });
 if (!response.ok && response.status !== 400) throw new BusinessProfileError('revocation_pending', 503);
}
export { DriveError };
