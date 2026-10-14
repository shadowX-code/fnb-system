import {describe,it,expect} from 'vitest';
import {platformUrl,allowedResource} from '../../../../server/creatorExtraction/urls.mjs';
import {publicIPv4} from '../../../../server/creatorExtraction/network.mjs';
import {safePostMediaUrl} from '../contentManagement.js';
import {extractMetadata,metric} from '../../../../server/creatorExtraction/extract.mjs';
describe('public Creator extraction boundaries',()=>{
 it('never adopts metadata from another canonical post or a generic login page',()=>{for(const target of ['https://www.instagram.com/','https://www.instagram.com/p/other/']){const p=extractMetadata('<meta property="og:url" content="'+target+'"><meta property="og:description" content="Other page text">','https://www.instagram.com/p/expected/');expect(p.metadata_status).toBe('unavailable');expect(p.caption).toBeUndefined()}});

 it('uses the canonical preview allowlist without broadening Meta previews',()=>{expect(safePostMediaUrl('https://p16.tiktokcdn.com/a.jpg','tiktok')).toBeTruthy();expect(safePostMediaUrl('https://p16.tiktokcdn.com/a.jpg')).toBeNull();expect(safePostMediaUrl('https://img.xhscdn.com/a.jpg','xhs')).toBeTruthy();expect(safePostMediaUrl('https://img.xhscdn.com.attacker.test/a.jpg','xhs')).toBeNull()});

 it('normalizes exact post identities while keeping share parameters request-only',()=>{
  expect(platformUrl('https://www.instagram.com/tasteeipoh/p/DSXLNZqCJzl/').post_id).toBe('DSXLNZqCJzl');const p=platformUrl('https://www.xiaohongshu.com/explore/68523c3c0000000012004bae?xsec_token=test');expect(p.canonical_url).not.toContain('token');expect(p.request_url).toContain('token');
  expect(platformUrl('https://vt.tiktok.com/ZSg1ckWPS/').share).toBe(true);
  for(const u of ['https://instagram.com.evil.test/p/a/','http://instagram.com/p/a/','https://x:y@instagram.com/p/a/','https://instagram.com:444/p/a/','https://instagram.com/accounts/login/'])expect(()=>platformUrl(u)).toThrow();
 });
 it('blocks private addresses, unrelated hosts and non-HTTPS requests',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1'])expect(publicIPv4(ip)).toBe(false);
  expect(publicIPv4('8.8.8.8')).toBe(true);expect(allowedResource('https://cdninstagram.com.attacker.test/a','instagram')).toBe(false);expect(allowedResource('https://cdninstagram.com/a','instagram')).toBe(true);
 });
 it('extracts an actual Instagram metadata shape without copying counter prefixes into caption',()=>{
  const html='<meta property="og:description" content=\'180 likes, 1 comments - tasteeipoh on December 17, 2025: "Actual caption".\'><meta property="og:image" content="https://scontent.cdninstagram.com/a.jpg"><time datetime="2025-12-17T11:00:18Z"></time>';
  const p=extractMetadata(html,'https://www.instagram.com/p/DSXLNZqCJzl/');expect(p.caption).toBe('Actual caption');expect(p.published_at).toBe('2025-12-17T11:00:18Z');expect(p.date_precision).toBe('instant');const dateOnly=extractMetadata(html.replace(/<time[^>]*><\/time>/,''),'https://www.instagram.com/p/DSXLNZqCJzl/');expect(dateOnly.published_at).toBe('2025-12-17');expect(dateOnly.date_precision).toBe('date');expect(p.author_handle).toBe('tasteeipoh');expect(p.metrics).toEqual({likes:180,comments:1});expect(p.unavailable.shares).toBeTruthy();expect(p.provenance.likes.estimated).toBe(false);
 });
 it('leaves absent and labelled counters unavailable, while retaining genuine zero',()=>{
  expect(metric('Likes')).toBe(null);expect(metric('0')).toBe(0);expect(metric('24.1K')).toBe(24100);
  const p=extractMetadata('<script type="application/ld+json">{"@type":"VideoObject","description":"Caption","interactionStatistic":[{"interactionType":"LikeAction","userInteractionCount":0}]}</script>','https://www.tiktok.com/@a/video/123/');
  expect(p.metrics.likes).toBe(0);expect(p.metrics.views).toBeUndefined();expect(p.published_at).toBeUndefined();
 });
 it('preserves date-only precision and stable public profile identity',()=>{
  const p=extractMetadata('<div class="author-wrapper"><a href="/user/profile/563df115e4b1cf31443e8b25"><span class="username">Name</span></a></div><div id="detail-desc">Caption</div><span class="date">2025-07-01</span>','https://www.xiaohongshu.com/explore/68523c3c0000000012004bae');
  expect(p.published_at).toBe('2025-07-01');expect(p.date_precision).toBe('date');expect(p.author_external_id).toBe('563df115e4b1cf31443e8b25');
 });
 it('never executes scripts to parse public state',()=>{
  const p=extractMetadata('<script>window.__INITIAL_STATE__=alert("unsafe")</script>','https://www.xiaohongshu.com/explore/68523c3c0000000012004bae');expect(p.metadata_status).toBe('unavailable');
 });
});
