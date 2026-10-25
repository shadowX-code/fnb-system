import {beforeEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {postMediaItems,postThumbnailItem} from '../postMedia.js';
import {PostMedia} from '../PostDetail.jsx';
import {Thumbnail} from '../ContentManagement.jsx';
import {marketingService} from '../marketingService.js';
vi.mock('../marketingService.js',()=>({marketingService:{assetUrl:vi.fn()}}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
const url='https://scontent.cdninstagram.com/published.jpg';
const asset={id:'approved-snapshot',state:'retired',mime_type:'image/jpeg'};
const channel={channel:'instagram',status:'published',provider_post_id:'222',assets:[asset],asset,thumbnail_url:url,media:[{type:'image',url}]};
it('uses exact synchronized media after retirement in both thumbnail and detail without signing retired evidence',async()=>{
 render(<><Thumbnail channel={channel}/><PostMedia channel={channel}/></>);
 await waitFor(()=>expect(document.querySelectorAll('img')).toHaveLength(2));
 expect([...document.querySelectorAll('img')].every(x=>x.src===url)).toBe(true);
 expect(marketingService.assetUrl).not.toHaveBeenCalled();expect(screen.queryByText(/snapshot no longer/)).toBeNull();
});
it('falls back once from an unreadable ready snapshot to matching provider media',async()=>{
 marketingService.assetUrl.mockRejectedValue(new Error('not stored'));
 render(<PostMedia channel={{...channel,assets:[{...asset,state:'ready'}]}}/>);
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toBe(url));
 expect(marketingService.assetUrl).toHaveBeenCalledTimes(1);
 fireEvent.error(screen.getByRole('img'));expect(await screen.findByText(/Media preview unavailable/)).toBeTruthy();
 expect(marketingService.assetUrl).toHaveBeenCalledTimes(1);
});
it('recovers an expired CDN preview when normal Social Sync supplies a fresh URL',async()=>{
 const {rerender}=render(<PostMedia channel={channel}/>);
 fireEvent.error(await screen.findByRole('img'));expect(screen.getByText(/Media preview unavailable/)).toBeTruthy();
 const refreshed='https://scontent.cdninstagram.com/fresh.jpg';
 rerender(<PostMedia channel={{...channel,media:[{type:'image',url:refreshed}]}}/>);
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toBe(refreshed));
});
it('keeps carousel order and all provider items when any local snapshot is retired',()=>{
 const data={...channel,assets:[{...asset,id:'a',state:'ready'},{...asset,id:'b'}],media:[{type:'image',url},{type:'video',url:'https://scontent.cdninstagram.com/two.mp4'}]};
 expect(postMediaItems(data).map(x=>x.type)).toEqual(['image','video']);expect(postMediaItems(data).some(x=>x.asset)).toBe(false);
});
it('does not turn a video URL into an image thumbnail or borrow a different channel asset',()=>{
 expect(postThumbnailItem({channel:'instagram',media:[{type:'video',url:'https://scontent.cdninstagram.com/a.mp4'}]})).toBeUndefined();
 expect(postMediaItems({...channel,media:[],thumbnail_url:null})).toEqual([]);
 expect(postMediaItems({...channel,media:[{type:'image',url:'https://evil.example/a.jpg?access_token=secret'}],thumbnail_url:null})).toEqual([]);
});
it('retains private draft media, handles signed image failure, and ignores late previous-channel signing',async()=>{
 let resolveOld;marketingService.assetUrl.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue('https://private.example/current.jpg');
 const {rerender}=render(<PostMedia channel={{channel:'facebook',assets:[{id:'old',state:'ready',mime_type:'image/png'}]}}/>);
 rerender(<PostMedia channel={{channel:'instagram',assets:[{id:'current',state:'ready',mime_type:'image/jpeg'}]}}/>);
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toContain('current.jpg'));
 resolveOld('https://private.example/old.jpg');await Promise.resolve();expect(screen.getByRole('img').getAttribute('src')).toContain('current.jpg');
});

it('never leaks a prior Brand/channel image when independent identities are selected',async()=>{
 const fb='https://scontent.fbcdn.net/page-a.jpg',ig='https://scontent.cdninstagram.com/brand-b.jpg';
 const {rerender}=render(<PostMedia channel={{channel:'facebook',provider_post_id:'111_222',brand_id:'brand-a',media:[{type:'image',url:fb}]}}/>);
 expect((await screen.findByRole('img')).getAttribute('src')).toBe(fb);
 rerender(<PostMedia channel={{channel:'instagram',provider_post_id:'222',brand_id:'brand-b',media:[{type:'image',url:ig}]}}/>);
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toBe(ig));
 rerender(<PostMedia channel={{channel:'instagram',provider_post_id:'unresolved',brand_id:'brand-c',media:[]}}/>);
 expect(screen.queryByRole('img')).toBeNull();expect(marketingService.assetUrl).not.toHaveBeenCalled();
});
