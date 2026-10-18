import {describe,it,expect} from 'vitest';
import {creatorAccountConflict,recognizeCreatorProfile,profileConflict} from '../creatorProfiles.js';
describe('staff profile URL recognition',()=>{
 it.each([['https://instagram.com/First.Alias/?utm=1','instagram','first.alias',''],['https://www.tiktok.com/@second.alias','tiktok','second.alias',''],['https://xiaohongshu.com/user/profile/ABC123?source=1','xhs','','abc123'],['https://m.facebook.com/profile.php?id=12345&tracking=1','facebook','','12345']])('recognizes %s without verifying ownership',(url,platform,handle,external_id)=>{expect(recognizeCreatorProfile(url)).toMatchObject({platform,handle,external_id})});
 it.each(['https://instagram.com.evil.test/person','https://user:pass@instagram.com/person','https://instagram.com:444/person','https://instagram.com/p/POST/','http://tiktok.com/@test','https://facebook.com/share/'])('rejects unsafe or non-profile URL %s',url=>{expect(()=>recognizeCreatorProfile(url)).toThrow()});
 it('finds exact aliases independently of display name or Creator brand',()=>{expect(profileConflict({platform:'instagram',handle:'ALIAS'},[{id:'a',creator_id:'c',platform:'instagram',handle:'alias',display_name:'Totally different'}])).toMatchObject({id:'a'});expect(profileConflict({platform:'instagram',display_name:'Same name'},[{id:'a',platform:'instagram',display_name:'Same name'}])).toBeUndefined()});
});
it('never constructs a link from a handle or opens an unsupported/mismatched saved URL',async()=>{
 const {creatorProfileLink}=await import('../creatorProfiles.js');
 expect(creatorProfileLink({platform:'facebook',profile_url:'https://m.facebook.com/profile.php?id=123&tracking=1'})).toBe('https://www.facebook.com/profile.php?id=123');
 expect(creatorProfileLink({platform:'xhs',profile_url:'https://xiaohongshu.com/user/profile/ABC123?share=1'})).toBe('https://www.xiaohongshu.com/user/profile/abc123');
 expect(creatorProfileLink({platform:'tiktok',handle:'no_url'})).toBeNull();expect(creatorProfileLink({platform:'facebook',profile_url:'https://facebook.com/profile.php'})).toBeNull();expect(creatorProfileLink({platform:'facebook',profile_url:'https://instagram.com/alias/'})).toBeNull();
});

it('keeps equivalent XHS profile URLs on one identity and distinct accounts separate',()=>{
 const expected=recognizeCreatorProfile('https://www.xiaohongshu.com/user/profile/5dcaaad4000000000100911c');
 expect(recognizeCreatorProfile('https://xiaohongshu.com/user/profile/5DCAAAD4000000000100911C/?source=share#profile')).toEqual(expected);
 expect(recognizeCreatorProfile('https://www.xiaohongshu.com/user/profile/5dcaaad4000000000100911d').external_id).not.toBe(expected.external_id);
});

it('recognizes only structured canonical account conflicts, never provider failures',()=>{
 const identity={kind:'creator_account_conflict',account_id:'account',creator_id:'creator',same_creator:false,creator_name:'Existing'};
 expect(creatorAccountConflict({code:'23505',details:JSON.stringify(identity)})).toEqual(identity);
 for(const error of [{code:'23505',details:'Key already exists'},{code:'42501',details:JSON.stringify(identity)},{message:'Provider unavailable'},{code:'23505',details:'{}'}])expect(creatorAccountConflict(error)).toBeNull();
});
