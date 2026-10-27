import {it,expect} from 'vitest';
import {publishingFormatKey,publishingFormatEnabled} from '../../../../supabase/functions/_shared/publishingFormatPolicy.mjs';
const fb={channel:'facebook',format:'video'},ig={channel:'instagram',format:'carousel'},mix=['image/jpeg','video/mp4'];
it.each([['facebook','video','facebook_video'],['facebook','reel','facebook_reel'],['instagram','carousel','instagram_mixed_carousel']])('routine %s/%s does not require a QA switch or lease', (channel,format,key)=>{expect(publishingFormatEnabled({channel,format},mix,{[key]:'routine'},{})).toBe(true);});
it.each(['routine','temporary',null,undefined,'enabled',true])('Stories are disabled for all authority representations (%s)',kind=>{expect(publishingFormatEnabled({channel:'instagram',format:'story'},mix,{instagram_story:kind},{instagram_extended_execution_enabled:true})).toBe(false);});
it('a QA switch alone never grants account permission',()=>{expect(publishingFormatEnabled(fb,[],{}, {facebook_video_execution_enabled:true})).toBe(false);});
it('QA authorization requires its own runtime switch',()=>{expect(publishingFormatEnabled(fb,[],{facebook_video:'temporary'},{})).toBe(false);expect(publishingFormatEnabled(fb,[],{facebook_video:'temporary'},{facebook_video_execution_enabled:true})).toBe(true);});
it('routine grants are exact-format and exact-channel',()=>{expect(publishingFormatEnabled({...fb,format:'reel'},[],{facebook_video:'routine'},{})).toBe(false);expect(publishingFormatEnabled(ig,mix,{facebook_video:'routine'},{})).toBe(false);});
it('mixed authority does not authorize unaccepted video-only carousels',()=>{expect(publishingFormatKey(ig,['video/mp4','video/mp4'])).toBe('instagram_video_carousel');expect(publishingFormatEnabled(ig,['video/mp4'],{instagram_mixed_carousel:'routine'},{})).toBe(false);expect(publishingFormatEnabled(ig,['video/mp4'],{instagram_video_carousel:'routine'},{})).toBe(false);});
it('legacy image carousels, text/image posts and IG Reels retain their ordinary format path',()=>{for(const [v,t]of [[{channel:'facebook',format:'text'},[]],[{channel:'facebook',format:'image'},['image/jpeg']],[ig,['image/jpeg','image/jpeg']],[{channel:'instagram',format:'reel'},['video/mp4']]])expect(publishingFormatEnabled(v,t,{},{})).toBe(true);});
it('late switch revocation blocks QA without revoking routine grants',()=>{const a={instagram_mixed_carousel:'temporary'};expect(publishingFormatEnabled(ig,mix,a,{instagram_extended_execution_enabled:true})).toBe(true);expect(publishingFormatEnabled(ig,mix,a,{})).toBe(false);expect(publishingFormatEnabled(ig,mix,{instagram_mixed_carousel:'routine'},{})).toBe(true);});

it.each(['Happiness','Hola','JYMT','Friends Corner','Idamans','Future eligible Brand'])('normal mode uses current eligibility for %s without account grants',()=>{
 for(const [v,t,key] of [[fb,[], 'facebook_video'],[{channel:'facebook',format:'reel'},[],'facebook_reel'],[ig,mix,'instagram_mixed_carousel']])expect(publishingFormatEnabled(v,t,{normal_formats:[key]},{normal_format_execution_enabled:true})).toBe(true);
});
it('normal mode ignores legacy grants and QA flags when current eligibility is missing',()=>{
 for(const a of [{facebook_video:'routine'},{facebook_video:'temporary',normal_formats:[]},{normal_formats:['instagram_mixed_carousel']},{normal_formats:'facebook_video'}])expect(publishingFormatEnabled(fb,[],a,{normal_format_execution_enabled:true,facebook_video_execution_enabled:true})).toBe(false);
 expect(publishingFormatEnabled(fb,[],{normal_formats:['facebook_video']},{})).toBe(false);
});
it('normal mode never enables Stories or video-only carousel through legacy metadata',()=>{
 const a={normal_formats:['instagram_story','instagram_video_carousel','instagram_mixed_carousel'],instagram_story:'routine',instagram_video_carousel:'temporary'};
 for(const [v,t] of [[{channel:'instagram',format:'story'},mix],[ig,['video/mp4','video/mp4']]])expect(publishingFormatEnabled(v,t,a,{normal_format_execution_enabled:true,instagram_extended_execution_enabled:true})).toBe(false);
});
