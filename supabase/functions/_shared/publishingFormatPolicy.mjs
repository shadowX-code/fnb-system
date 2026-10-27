// Canonical SQL supplies current account eligibility; runtime mode and QA switches only narrow it.
export function publishingFormatKey(variant,types=[]) {
 if(variant?.channel==='facebook'&&['video','reel'].includes(variant.format))return 'facebook_'+variant.format;
 if(variant?.channel==='instagram'&&variant.format==='story')return 'instagram_story';
 if(variant?.channel==='instagram'&&variant.format==='carousel'&&types.includes('video/mp4'))return types.some(t=>t?.startsWith('image/'))?'instagram_mixed_carousel':'instagram_video_carousel';
 return null;
}
export function publishingFormatAuthorization(variant,types,authorizations,switches={}) {
 const key=publishingFormatKey(variant,types);if(!key)return null;
 if(key==='instagram_story')return null;
 if(switches.normal_format_execution_enabled===true)return ['facebook_video','facebook_reel','instagram_mixed_carousel'].includes(key)&&Array.isArray(authorizations?.normal_formats)&&authorizations.normal_formats.includes(key)?'routine':null;
 const kind=authorizations?.[key];
 if(kind==='routine')return ['facebook_video','facebook_reel','instagram_mixed_carousel'].includes(key)?'routine':null;
 return kind==='temporary'&&(key.startsWith('facebook_')?switches.facebook_video_execution_enabled===true:switches.instagram_extended_execution_enabled===true)?'temporary':null;
}

export function publishingFormatEnabled(variant,types,authorizations,switches={}) {
 return !publishingFormatKey(variant,types)||publishingFormatAuthorization(variant,types,authorizations,switches)!==null;
}
