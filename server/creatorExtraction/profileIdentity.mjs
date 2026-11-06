import {recognizeCreatorProfile} from '../../src/features/marketing/creatorProfiles.js';
export function profileIdentity(url){const p=recognizeCreatorProfile(url);return {...p,request_url:p.profile_url,canonical_url:p.profile_url};}
