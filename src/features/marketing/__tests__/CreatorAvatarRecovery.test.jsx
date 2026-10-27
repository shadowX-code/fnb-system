import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import CreatorAvatar from '../CreatorAvatar.jsx';
import {renewCreatorAvatar} from '../creatorAvatarRenewal.js';
vi.mock('../creatorAvatarRenewal.js',()=>({renewCreatorAvatar:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks()});
const creator={id:'c',name:'Real Creator'},account={id:'a',creator_id:'c',platform:'instagram',profile_url:'https://www.instagram.com/one/',public_observation:{source:'public_profile_staff_confirmed',avatar_kind:'profile_picture',profile_url:'https://www.instagram.com/one/',captured_at:'2026-10-15T00:00:00Z',avatar_url:'https://scontent.cdninstagram.com/old.jpg'}};
it('renders a newly persisted canonical URL after a failed image and bounded renewal',async()=>{
 renewCreatorAvatar.mockResolvedValue({...account,public_observation:{...account.public_observation,avatar_url:'https://scontent.cdninstagram.com/new.jpg'}});render(<CreatorAvatar creator={creator} accounts={[account]} org="org" brandId="brand" canRefresh/>);fireEvent.error(screen.getByRole('img'));await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toContain('new.jpg'));expect(renewCreatorAvatar).toHaveBeenCalledTimes(1);
});
it('retains initials when provider renewal fails and never mutates for a read-only viewer',async()=>{
 renewCreatorAvatar.mockResolvedValue(null);const {rerender}=render(<CreatorAvatar creator={creator} accounts={[account]} org="org" brandId="brand"/>);fireEvent.error(screen.getByRole('img'));expect(screen.getByLabelText('Real Creator initials')).toBeTruthy();expect(renewCreatorAvatar).not.toHaveBeenCalled();rerender(<CreatorAvatar key="editor" creator={creator} accounts={[account]} org="org" brandId="brand" canRefresh/>);fireEvent.error(screen.getByRole('img'));await waitFor(()=>expect(renewCreatorAvatar).toHaveBeenCalledOnce());expect(screen.getByLabelText('Real Creator initials')).toBeTruthy();
});

it('renders delegated provider evidence without relabeling it as staff-confirmed',()=>{
 const o={...account.public_observation,source:'meta_instagram_business_discovery',request_id:'11111111-1111-4111-8111-111111111111',connection_id:'22222222-2222-4222-8222-222222222222',delegation_epoch:'33333333-3333-4333-8333-333333333333',connection_generation:5};
 const {rerender}=render(<CreatorAvatar creator={creator} accounts={[{...account,public_observation:o}]}/>);expect(screen.getByRole('img')).toBeTruthy();
 rerender(<CreatorAvatar creator={creator} accounts={[{...account,public_observation:{...o,request_id:null}}]}/>);expect(screen.queryByRole('img')).toBeNull();expect(screen.getByLabelText('Real Creator initials')).toBeTruthy();
});
