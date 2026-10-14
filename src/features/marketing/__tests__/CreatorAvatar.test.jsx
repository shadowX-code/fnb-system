// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
import CreatorAvatar,{creatorAvatarUrl,creatorInstagramAccount} from '../CreatorAvatar.jsx';
afterEach(cleanup);
const c={id:'c',name:'Test Creator'},a={id:'a',creator_id:'c',platform:'instagram',profile_url:'https://www.instagram.com/test.creator/',public_observation:{source:'public_profile_staff_confirmed',avatar_kind:'profile_picture',profile_url:'https://www.instagram.com/test.creator/',captured_at:'2026-10-14T00:00:00Z',avatar_url:'https://scontent.cdninstagram.com/profile.jpg'}};
describe('Instagram-first Creator avatar',()=>{
 it('uses bound profile evidence and ignores post/media/foreign images',()=>{expect(creatorAvatarUrl(c,[a])).toBe(a.public_observation.avatar_url);expect(creatorAvatarUrl({...c,avatar_asset_id:'post'},[{...a,public_observation:{...a.public_observation,avatar_kind:'post_thumbnail'}}])).toBeNull();expect(creatorAvatarUrl(c,[{...a,creator_id:'foreign'}])).toBeNull();expect(creatorAvatarUrl(c,[{...a,public_observation:{...a.public_observation,profile_url:'https://www.instagram.com/other/'}}])).toBeNull()});
 it('honors primary Instagram without using another account when its image is unavailable',()=>{const b={...a,id:'b',public_observation:null};expect(creatorInstagramAccount({...c,primary_instagram_account_id:'b'},[a,b])).toBe(b);expect(creatorAvatarUrl({...c,primary_instagram_account_id:'b'},[a,b])).toBeNull();expect(creatorInstagramAccount({...c,primary_instagram_account_id:'b'},[a,{...b,archived:true}])).toBe(a)});
 it('falls back to initials after expired image errors and retries a changed URL',()=>{const {rerender}=render(<CreatorAvatar creator={c} accounts={[a]}/>);fireEvent.error(screen.getByRole('img'));expect(screen.getByLabelText('Test Creator initials').textContent).toBe('TC');rerender(<CreatorAvatar creator={c} accounts={[{...a,public_observation:{...a.public_observation,avatar_url:'https://scontent.cdninstagram.com/new.jpg'}}]}/>);expect(screen.getByRole('img').getAttribute('src')).toContain('new.jpg')});
});
