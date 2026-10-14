import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import CreatorPostLink,{creatorPostOriginalUrl} from '../CreatorPostLink.jsx';
afterEach(cleanup);
it('opens only preserved validated XHS URLs and never reconstructs legacy navigation',()=>{
 const post={platform:'xhs',post_key:'6a8fb7f30000000037034698',canonical_url:'https://www.xiaohongshu.com/explore/6a8fb7f30000000037034698'};
 const url='https://www.xiaohongshu.com/discovery/item/'+post.post_key+'?source=webshare&xsec_token=a%2Bb%2Fc%3D&xsec_source=pc_share';
 const {rerender}=render(<CreatorPostLink post={post}/>);expect(screen.queryByRole('link')).toBeNull();expect(screen.getByText('Original link unavailable')).toBeTruthy();
 rerender(<CreatorPostLink post={{...post,original_url:url}}/>);const link=screen.getByRole('link');expect(link.getAttribute('href')).toBe(url);expect(link.getAttribute('target')).toBe('_blank');expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');expect(link.textContent).not.toContain('xsec_token');
 for(const original_url of ['javascript:alert(1)','https://xiaohongshu.com.evil.test/explore/'+post.post_key,'https://www.xiaohongshu.com/explore/68523c3c0000000012004bae'])expect(creatorPostOriginalUrl({...post,original_url})).toBeNull();
 expect(creatorPostOriginalUrl({...post,original_url:'https://xhslink.com/o/8ztP9aMRnzT'})).toBe('https://xhslink.com/o/8ztP9aMRnzT');
});
