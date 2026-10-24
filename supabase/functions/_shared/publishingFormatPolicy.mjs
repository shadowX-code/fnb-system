// Permission remains in canonical SQL; this shared mapper applies only QA runtime switches.
export function publishingFormatKey(variant,types=[]) {
 if(variant?.channel==='facebook'&&['video','reel'].includes(variant.format))return 'facebook_'+variant.format;
 if(variant?.channel==='instagram'&&variant.format==='story')return 'instagram_story';
 if(variant?.channel==='instagram'&&variant.format==='carousel'&&types.includes('video/mp4'))return types.some(t=>t?.startsWith('image/'))?'instagram_mixed_carousel':'instagram_video_carousel';
 return null;
}
export function publishingFormatEnabled(variant,types,authorizations,switches={}) {
 const key=publishingFormatKey(variant,types);if(!key)return true;
 if(key==='instagram_story')return false;
 const kind=authorizations?.[key];
 if(kind==='routine')return ['facebook_video','facebook_reel','instagram_mixed_carousel'].includes(key);
 return kind==='temporary'&&(key.startsWith('facebook_')?switches.facebook_video_execution_enabled===true:switches.instagram_extended_execution_enabled===true);
}
