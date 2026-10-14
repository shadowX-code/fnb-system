// URL recognition is a data-entry aid; it never verifies ownership or fetches a profile.
export function recognizeCreatorProfile(value) {
 if(typeof value!=='string'||value.length>1500)throw new Error('Use a supported public profile URL.');
 const url=new URL(value.trim());
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Use a public HTTPS profile URL.');
 const host=url.hostname.toLowerCase(),path=url.pathname.replace(/\/$/,'');let platform,handle='',external_id='',canonical;
 if(['instagram.com','www.instagram.com'].includes(host)&&/^\/[a-z0-9._]+$/i.test(path)&&!['p','reel','reels','stories','explore','accounts','direct'].includes(path.slice(1).toLowerCase())){platform='instagram';handle=path.slice(1).toLowerCase();canonical=`https://www.instagram.com/${handle}/`;}
 else if(['tiktok.com','www.tiktok.com'].includes(host)&&/^\/@[a-z0-9._-]+$/i.test(path)){platform='tiktok';handle=path.slice(2).toLowerCase();canonical=`https://www.tiktok.com/@${handle}`;}
 else if(['xiaohongshu.com','www.xiaohongshu.com'].includes(host)&&/^\/user\/profile\/[a-f0-9]+$/i.test(path)){platform='xhs';external_id=path.split('/').pop().toLowerCase();canonical=`https://www.xiaohongshu.com/user/profile/${external_id}`;}
 else if(['facebook.com','www.facebook.com','m.facebook.com'].includes(host)){
 platform='facebook';if(path==='/profile.php'&&/^\d+$/.test(url.searchParams.get('id')||'')){external_id=url.searchParams.get('id');canonical=`https://www.facebook.com/profile.php?id=${external_id}`;}
 else if(/^\/[a-z0-9._-]+$/i.test(path)&&!['share','reel','watch','photo','story.php','groups','pages'].includes(path.slice(1).toLowerCase())){const id=path.slice(1).toLowerCase();if(/^\d+$/.test(id))external_id=id;else handle=id;canonical=`https://www.facebook.com/${id}`;}
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
