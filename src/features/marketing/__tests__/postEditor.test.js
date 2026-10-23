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
