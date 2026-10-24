import {it,expect,vi} from 'vitest';
import {advanceMetaPublish,type MetaLedger} from '../../../../supabase/functions/_shared/metaPublishing.ts';
import {MetaGraph,MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const video='1830341231428452',account='622626120924115',post='622626120924115_122185805978804842';
// Public T3 identities are provider-observed. Missing/unqualified video.post_id shapes
// are controlled scenarios: the original raw field was not retained in Production.
const videoEvidence={id:video,from:{id:account},published:true,status:{video_status:'ready'}};
const pageRow={id:post,permalink_url:`https://www.facebook.com/reel/${video}/`};
function setup(evidence:any=videoEvidence,rows:any=[pageRow],initial:MetaLedger={objects:{fb_video:video,fb_finish:video}}){
 let state=structuredClone(initial);const guard=vi.fn().mockResolvedValue(undefined),submissionGuard=vi.fn().mockRejectedValue(new Error('execution disabled'));
 const transport=vi.fn(async(url:any,options:any)=>{
  expect(options.method).toBe('GET');const path=new URL(url).pathname;
  expect([`/v26.0/${video}`,`/v26.0/${account}/posts`]).toContain(path);
  return new Response(JSON.stringify(path.endsWith('/posts')?{data:rows}:evidence));
 });
 const graph=new MetaGraph({appId:'1',appSecret:'fixture',configId:'2',version:'v26.0'},transport);
 return {transport,guard,submissionGuard,state:()=>state,run:(patch:any={})=>advanceMetaPublish({graph,accountId:account,token:'fixture-token',variant:{channel:'facebook',format:'video',caption:'fixture',asset_ids:[]},mediaUrls:[],state,guard,submissionGuard,checkpoint:async s=>{state=structuredClone(s)},reconcileOnly:true,allowFacebookReceiptLookup:()=>true,...patch})};
}
it.each([undefined,null,video,'122185805978804842'])('resolves the owned canonical Post through the exact retained Reel identity; video.post_id=%s',async raw=>{
 const h=setup({...videoEvidence,post_id:raw});expect(await h.run()).toEqual({outcome:'published',postId:post});
 expect(h.transport).toHaveBeenCalledTimes(2);expect(h.submissionGuard).not.toHaveBeenCalled();
 expect(h.state().objects).toEqual({fb_video:video,fb_finish:video});
 expect(h.state().facebook_receipt).toEqual({source:'page_posts_video_permalink',video_id:video,post_id:post,video_post_id:raw??null});
 const url=new URL(h.transport.mock.calls[1][0]);expect(url.searchParams.get('fields')).toBe('id,permalink_url');expect(url.searchParams.get('limit')).toBe('25');
});
it('keeps existing valid video.post_id receipts on the original single-read path',async()=>{
 const h=setup({...videoEvidence,post_id:post});expect(await h.run()).toEqual({outcome:'published',postId:post});expect(h.transport).toHaveBeenCalledOnce();
});
it('keeps the new reconciliation lookup dormant unless explicitly allowed',async()=>{
 const h=setup();expect(await h.run({allowFacebookReceiptLookup:()=>false})).toMatchObject({outcome:'uncertain',code:'facebook_video_post_receipt_missing'});expect(h.transport).toHaveBeenCalledOnce();expect(h.state().post_id).toBeUndefined();
});
it.each([
 [],[{id:post,permalink_url:'https://www.facebook.com/reel/999/'}],
 [{id:post,permalink_url:`https://evil.example/reel/${video}`}],
 [{id:post,permalink_url:`https://www.facebook.com.evil.example/reel/${video}`}],
 [{id:post,permalink_url:`http://www.facebook.com/reel/${video}`}],
 [{id:post,permalink_url:`https://fixture@www.facebook.com/reel/${video}`}],
 [{id:post,permalink_url:`https://www.facebook.com/reel/${video}0`}],
 [{id:post,permalink_url:`https://www.facebook.com/reel/${video}/extra`}]
].map(rows=>[rows]))('does not establish an identity from missing/wrong/unsafe permalink evidence %j',async rows=>{
 const h=setup(videoEvidence,rows);expect((await h.run()).outcome).toBe('uncertain');expect(h.state().post_id).toBeUndefined();expect(h.transport).toHaveBeenCalledTimes(2);
});
it.each([
 [{id:'999_123',permalink_url:pageRow.permalink_url}],
 [{id:123,permalink_url:pageRow.permalink_url}],
 [pageRow,{...pageRow,id:account+'_999'}],
 Array.from({length:26},()=>pageRow)
].map(rows=>[rows]))('rejects foreign/invalid/ambiguous/oversized Page result sets',async rows=>{
 const h=setup(videoEvidence,rows);expect((await h.run()).outcome).toBe('uncertain');expect(h.state().post_id).toBeUndefined();
});
it.each([{from:{id:'999'}},{id:'999'},{published:false},{published:'true'},{status:{video_status:'processing'}}])('retains strict current Video publication/ownership proof %j',async patch=>{
 const h=setup({...videoEvidence,...patch});expect((await h.run()).outcome).toBe('uncertain');expect(h.transport).toHaveBeenCalledOnce();expect(h.state().post_id).toBeUndefined();
});
it('does not override a contradictory qualified Post from the Video response',async()=>{
 const h=setup({...videoEvidence,post_id:'999_123'});expect((await h.run()).outcome).toBe('uncertain');expect(h.transport).toHaveBeenCalledOnce();
});
it('does not infer publication without retained finish/pending publish intent',async()=>{
 const h=setup(videoEvidence,[pageRow],{objects:{fb_video:video}});expect((await h.run()).outcome).toBe('uncertain');expect(h.transport).toHaveBeenCalledOnce();
});
it('reconciles a lost publication response without reuploading or publishing',async()=>{
 const h=setup(videoEvidence,[pageRow],{objects:{fb_video:video},pending:'fb_publish'});expect((await h.run()).outcome).toBe('published');expect(h.state().pending).toBeUndefined();expect(h.submissionGuard).not.toHaveBeenCalled();
});
it('permission denial or authority changes preserve the complete original checkpoint',async()=>{
 const h=setup();const before=structuredClone(h.state());h.guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new MetaError('scope_changed'));
 expect((await h.run()).outcome).toBe('uncertain');expect(h.state()).toEqual(before);expect(h.transport).toHaveBeenCalledOnce();
 const denied=setup();denied.transport.mockResolvedValueOnce(new Response(JSON.stringify(videoEvidence))).mockResolvedValueOnce(new Response('{"error":{"code":10}}',{status:403}));
 expect(await denied.run()).toMatchObject({outcome:'uncertain',code:'meta_permission_or_token_invalid'});expect(denied.state().post_id).toBeUndefined();
});
it('remains idempotent and never changes a retained final Post identity',async()=>{
 const h=setup();expect((await h.run()).outcome).toBe('published');expect((await h.run()).outcome).toBe('published');expect(h.state().post_id).toBe(post);expect(h.submissionGuard).not.toHaveBeenCalled();
 const conflict=setup(videoEvidence,[pageRow],{objects:{fb_video:video,fb_finish:video},post_id:account+'_999'});expect((await conflict.run()).outcome).toBe('uncertain');expect(conflict.state().post_id).toBe(account+'_999');
});
it('works for both Facebook Video and Reel receipts without changing Instagram contracts',async()=>{
 const h=setup();expect((await h.run({variant:{channel:'facebook',format:'reel',caption:'fixture',asset_ids:[]}})).outcome).toBe('published');
});

it('rechecks short-lived recovery permission after the asynchronous authority guard',async()=>{
 const h=setup();const allowed=vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
 expect((await h.run({allowFacebookReceiptLookup:allowed})).outcome).toBe('uncertain');
 expect(h.transport).toHaveBeenCalledOnce();expect(h.state().post_id).toBeUndefined();
});
