import {beforeEach,expect,it,vi} from 'vitest';
import {creatorService} from '../creatorService.js';
vi.mock('../creatorService.js',()=>({creatorService:{directory:vi.fn(),profile:vi.fn(),command:vi.fn()}}));
let renew,creator,account;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();renew=(await import('../creatorAvatarRenewal.js')).renewCreatorAvatar;
 creator={id:'creator',editable:true};account={id:'a',creator_id:'creator',platform:'instagram',handle:'one',display_name:'Preserved',profile_url:'https://www.instagram.com/one/',external_id:'',followers:null,followers_captured_at:null,revision:2,public_observation:{source_hint:'Meta Instagram Business Discovery',source:'public_profile_staff_confirmed',profile_url:'https://www.instagram.com/one/',avatar_kind:'profile_picture',captured_at:'2026-10-15T00:00:00Z',avatar_url:'https://scontent.cdninstagram.com/old.jpg'}};
 creatorService.directory.mockResolvedValue({creators:[creator],accounts:[account]});creatorService.profile.mockResolvedValue({metadata_status:'public_extracted',source:'Meta Instagram Business Discovery',profile_url:account.profile_url,avatar_kind:'profile_picture',avatar_url:'https://scontent.cdninstagram.com/new.jpg',captured_at:'2026-10-15T01:00:00Z'});creatorService.command.mockImplementation(async p=>({...p.payload,revision:3}));
});
const args=()=>({org:'org',brand:'brand',creator,account});
it('renews only image evidence using the current canonical revision and preserves unrelated fields',async()=>{
 const result=await renew(args());expect(result.revision).toBe(3);expect(creatorService.command).toHaveBeenCalledWith(expect.objectContaining({action:'save_account',id:'a',revision:2,payload:expect.objectContaining({display_name:'Preserved',external_id:'',followers:null,followers_captured_at:null,public_observation:expect.objectContaining({source:'Meta Instagram Business Discovery',avatar_url:'https://scontent.cdninstagram.com/new.jpg'})})}));
});
it('coalesces concurrent image failures and leaves only cooldown metadata after completion',async()=>{
 const first=renew(args()),second=renew(args());expect(first).toBe(second);await first;expect(await renew(args())).toBeNull();expect(creatorService.profile).toHaveBeenCalledTimes(1);expect(creatorService.command).toHaveBeenCalledTimes(1);
});
it('preserves the record when Meta cannot supply a usable picture',async()=>{creatorService.profile.mockResolvedValue({metadata_status:'unavailable'});expect(await renew(args())).toBeNull();expect(creatorService.command).not.toHaveBeenCalled();});
it('does not save the same failed URL or unbound evidence',async()=>{creatorService.profile.mockResolvedValue({metadata_status:'public_extracted',source:'Meta Instagram Business Discovery',profile_url:account.profile_url,avatar_kind:'profile_picture',avatar_url:account.public_observation.avatar_url,captured_at:'2026-10-15T01:00:00Z'});expect(await renew(args())).toBeNull();expect(creatorService.command).not.toHaveBeenCalled();});
it('stops when the current primary or edit authority changed before renewal',async()=>{creatorService.directory.mockResolvedValue({creators:[{...creator,editable:false}],accounts:[account]});expect(await renew(args())).toBeNull();expect(creatorService.profile).not.toHaveBeenCalled();});
it('does not turn public-only image errors into speculative requests',async()=>{account.public_observation.source_hint='Public profile metadata';expect(await renew(args())).toBeNull();expect(creatorService.directory).not.toHaveBeenCalled();});
