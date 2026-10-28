// URL recognition is a data-entry aid; it never verifies ownership or fetches a profile.
export function recognizeCreatorProfile(value) {
 if(typeof value!=='string'||value.length>1500)throw new Error('Use a supported public profile URL.');
 const url=new URL(value.trim());
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Use a public HTTPS profile URL.');
 const host=url.hostname.toLowerCase(),path=url.pathname.replace(/\/$/,'');let platform,handle='',external_id='',canonical;
 if(['instagram.com','www.instagram.com'].includes(host)&&/^\/[a-z0-9._]{1,30}$/i.test(path)&&!['p','reel','reels','stories','explore','accounts','direct'].includes(path.slice(1).toLowerCase())){platform='instagram';handle=path.slice(1).toLowerCase();canonical=`https://www.instagram.com/${handle}/`;}
 else if(['tiktok.com','www.tiktok.com'].includes(host)&&/^\/@[a-z0-9._-]+$/i.test(path)){platform='tiktok';handle=path.slice(2).toLowerCase();canonical=`https://www.tiktok.com/@${handle}`;}
 else if(['xiaohongshu.com','www.xiaohongshu.com'].includes(host)&&/^\/user\/profile\/[a-f0-9]+$/i.test(path)){platform='xhs';external_id=path.split('/').pop().toLowerCase();canonical=`https://www.xiaohongshu.com/user/profile/${external_id}`;}
 else if(['facebook.com','www.facebook.com','m.facebook.com'].includes(host)){
 platform='facebook';if(path==='/profile.php'&&/^\d+$/.test(url.searchParams.get('id')||'')){external_id=url.searchParams.get('id');canonical=`https://www.facebook.com/profile.php?id=${external_id}`;}
 else if(/^\/[a-z0-9._-]+$/i.test(path)&&!['share','reel','watch','photo','profile.php','story.php','groups','pages'].includes(path.slice(1).toLowerCase())){const id=path.slice(1).toLowerCase();if(/^\d+$/.test(id))external_id=id;else handle=id;canonical=`https://www.facebook.com/${id}`;}
 }
 if(!canonical)throw new Error('Use a Facebook, Instagram, Xiaohongshu or TikTok profile link.');
 return {platform,profile_url:canonical,handle,external_id};
}
export function profileConflict(profile,accounts,creatorId){
 return accounts.find(a=>a!==profile&&(!profile.id||a.id!==profile.id)&&a.platform===profile.platform&&
 ((profile.handle&&a.handle?.toLowerCase()===profile.handle.replace(/^@/,'').toLowerCase())||
 (profile.external_id&&a.external_id===profile.external_id)||
 (profile.profile_url&&a.profile_url?.toLowerCase()===profile.profile_url.toLowerCase())));
}

// Only saved, supported URLs can be opened; a handle alone never creates a link.
export function creatorProfileLink(account){
 try{const profile=recognizeCreatorProfile(account.profile_url);return profile.platform===account.platform?profile.profile_url:null}catch{return null}
}

// Browser edits never submit server-owned follower evidence, including legacy values.
export function creatorProfilePayload(p){if(p.platform==='instagram')try{p={...p,...instagramProfileInput(p.profile_url),external_id:p.external_id||''}}catch{}const {_inspectedUrl,followers,followers_captured_at,followers_source,followers_sync_status,followers_sync_reason,followers_attempted_at,followers_due_at,followers_lease,followers_lease_until,...result}=p;if(result.platform==='instagram'){if(!result.profile_enrichment_receipt)delete result.profile_enrichment_receipt;if(result.public_observation?.enrichment_receipt)result.profile_enrichment_receipt=result.public_observation.enrichment_receipt;delete result.public_observation;}else if(!result.public_observation||result.public_observation.source==='public_profile_staff_confirmed')delete result.public_observation;return result}

// Only the canonical command resolves association conflicts; provider failures stay independent.
export function creatorAccountConflict(error){
 if(error?.code!=='23505'||typeof error.details!=='string')return null;
 try{const value=JSON.parse(error.details);return value.kind==='creator_account_conflict'&&value.account_id&&value.creator_id&&typeof value.same_creator==='boolean'?value:null}catch{return null}
}

// A partial refresh cannot date-stamp or erase a previously observed picture.
export function creatorProfileObservation(previous,result){
 if(result.metadata_status!=='public_extracted')return previous;
 const fresh={source:result.source,captured_at:result.captured_at,avatar_url:result.avatar_url||null,avatar_kind:result.avatar_kind||null,profile_url:result.profile_url,...(result.enrichment_receipt?{enrichment_receipt:result.enrichment_receipt}:{})};
 const usable=/^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net|xhscdn\.com|sns-i11\.rednotecdn\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|ibytedtos\.com)\//i.test(fresh.avatar_url||'');
 return usable?fresh:previous||{...fresh,avatar_url:null};
}

// Instagram accepts a username as an entry aid; stored and provider inputs remain canonical HTTPS URLs.
export function instagramProfileInput(value){
 const input=String(value||'').trim();
 const url=/^@?[a-z0-9._]{1,30}$/i.test(input)?`https://www.instagram.com/${input.replace(/^@/,'')}/`:/^(www\.)?instagram\.com\//i.test(input)?'https://'+input:input;
 const profile=recognizeCreatorProfile(url);if(profile.platform!=='instagram')throw new Error('Enter an Instagram profile URL or username.');return profile;
}
