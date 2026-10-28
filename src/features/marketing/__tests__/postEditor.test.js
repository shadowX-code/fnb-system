import {it,expect} from 'vitest';
import {POST_FORMATS,variantIssues,publishingAccount} from '../postEditor.js';
const brand={id:'b',organization_id:'o'};
const image={id:'a',brand_id:'b',organization_id:'o',state:'ready',mime_type:'image/jpeg',size_bytes:1024};
const variant={channel:'instagram',format:'image',caption:'Caption',asset_ids:['a']};
it('exposes verified Facebook video formats but keeps Instagram standalone video unavailable',()=>{expect(POST_FORMATS.facebook).toEqual(['text','image','carousel','video','reel']);expect(POST_FORMATS.instagram).not.toContain('video');expect(variantIssues({...variant,format:'video'},[image],brand)[0]).toContain('not supported');});
it('checks caption, cardinality, JPEG, size and Brand/tenant media identity without inferring provider validation',()=>{
 expect(variantIssues(variant,[image],brand)).toEqual([]);
 for(const patch of [{mime_type:'image/png'},{size_bytes:8388609},{brand_id:'other'},{organization_id:'other'},{state:'retired'}])expect(variantIssues(variant,[{...image,...patch}],brand)).not.toEqual([]);
 expect(variantIssues(variant,[],brand)[0]).toContain('unavailable');
 expect(variantIssues({...variant,caption:'',format:'carousel'},[image],brand)).toHaveLength(2);
 expect(variantIssues({...variant,caption:'x'.repeat(2201)},[image],brand)[0]).toContain('Shorten');
 expect(variantIssues({...variant,channel:'facebook',format:'text'},[image],brand)[0]).toContain('Remove media');
});
it('requires current scoped account capability independently of execution activation',()=>{
 const account={id:'c',brand_id:'b',organization_id:'o',channel:'instagram',status:'test_authorized',expires_at:'2099-01-01',capabilities:{publishing:true,formats:['image'],execution_enabled:false}};
 expect(publishingAccount(variant,[account],brand)).toEqual(account);
 for(const patch of [{brand_id:'other'},{organization_id:'other'},{expires_at:'2000-01-01'},{status:'disconnected'},{capabilities:{publishing:false,formats:['image']}}])expect(publishingAccount(variant,[{...account,...patch}],brand)).toBeUndefined();
 expect(publishingAccount({...variant,format:'reel'},[account],brand)).toBeUndefined();
});

import {mediaMetadataIssues} from '../postEditor.js';
it('shows known incompatible video/Story metadata without inferring publishability from MIME',()=>{const a={id:'v',filename:'Short.mp4',mime_type:'video/mp4'},m={v:{width:320,height:180,duration:2}};expect(mediaMetadataIssues({channel:'facebook',format:'video',asset_ids:['v']},[a],m)).toEqual([]);for(const v of [{channel:'facebook',format:'reel'},{channel:'instagram',format:'story'},{channel:'instagram',format:'carousel'}])expect(mediaMetadataIssues({...v,asset_ids:['v']},[a],m)).toHaveLength(1);});

import {mediaCopyIssues} from '../postEditor.js';
it('copies only complete scoped compatible media and validates destination cardinality without caption requirements',()=>{
 const second={...image,id:'b'},source={asset_ids:['b','a']},target={channel:'instagram',format:'carousel',caption:'',asset_ids:[]};
 expect(mediaCopyIssues(source,target,[image,second],brand)).toEqual([]);
 expect(mediaCopyIssues(source,{...target,format:'image'},[image,second],brand).join()).toContain('Choose one');
 expect(mediaCopyIssues(source,target,[{...image,mime_type:'image/png'},second],brand).join()).toContain('incompatible');
 expect(mediaCopyIssues(source,target,[{...image,brand_id:'other'},second],brand).join()).toContain('incompatible');
 expect(mediaCopyIssues(source,target,[second],brand).join()).toContain('unavailable');
 expect(mediaCopyIssues({asset_ids:Array.from({length:11},(_,i)=>String(i))},target,[],brand).join()).toContain('2–10');
 expect(mediaCopyIssues({asset_ids:['a','a']},target,[image],brand).join()).toContain('duplicate');
});
it('accepts mixed Instagram carousel references but rejects known video incompatibility and mismatched covers without replacing settings',()=>{
 const video={...image,id:'v',filename:'Video.mp4',mime_type:'video/mp4'},source={asset_ids:['a','v']},target={channel:'instagram',format:'carousel',asset_ids:[]};
 expect(mediaCopyIssues(source,target,[image,video],brand)).toEqual([]);
 expect(mediaCopyIssues(source,target,[image,video],brand,{v:{width:1920,height:1080,duration:61}}).join()).toContain('3–60 seconds');
 expect(mediaCopyIssues({asset_ids:['v']},{channel:'instagram',format:'reel',asset_ids:['old'],reel_cover:{mode:'frame',video_asset_id:'old',offset_ms:0}},[video],brand).join()).toContain('cover again');
 expect(mediaCopyIssues(source,{...target,format:'story'},[image,video],brand).join()).toContain('supported Instagram');
});
