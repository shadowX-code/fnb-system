import {it,expect} from 'vitest';
import {publishingEntries} from '../plannerPublishing.js';
const task={id:'task',brand_id:'brand',brand_name:'Brand',title:'Plan',planned_publish_date:'2026-10-10',linked_content_id:'content'};
const record={id:'content',key:'content',brand_id:'brand',title:'Real content',planned_at:'2026-10-09T16:00:00Z',scheduled_at:'2026-10-10T16:00:00Z',status:'failed',channels:[{channel:'facebook',status:'published',actual_at:'2026-10-11T16:00:00Z'},{channel:'instagram',status:'failed'}]};
it('preserves exact channel dates and partial results while replacing the linked task',()=>{
 const rows=publishingEntries([task],[record]);expect(rows).toHaveLength(2);expect(rows[0].date).toBe('2026-10-12');expect(rows[0].channels[0].status).toBe('published');expect(rows[1].date).toBe('2026-10-11');expect(rows[1].channels[0].status).toBe('failed');expect(rows.every(r=>!r.task)).toBe(true);
});
it('uses task planning date only for an undated linked draft and preserves missing evidence',()=>{
 const rows=publishingEntries([task],[{...record,planned_at:null,scheduled_at:null,channels:[{channel:'facebook',status:'draft'}]}]);expect(rows).toHaveLength(1);expect(rows[0].date).toBe(task.planned_publish_date);expect(rows[0].channels[0].status).toBe('draft');
 expect(publishingEntries([task],[])[0].status).toBe('unavailable');expect(publishingEntries([{...task,linked_content_id:null}],[])[0].status).toBe('planned');
});
it('does not combine unrelated external posts or lose unavailable channel timing',()=>{
 const external={...record,id:null,key:'meta:one',planned_at:null,scheduled_at:null,display_at:'2026-10-11T16:00:00Z',channels:[{channel:'instagram',status:'published',actual_at:'2026-10-11T16:00:00Z'}]};
 expect(publishingEntries([],[external,{...external,key:'meta:two'}])).toHaveLength(2);
 const receipt={...record,channels:[{channel:'facebook',status:'published',actual_at:null}]};expect(publishingEntries([],[receipt])[0].channels[0].actual_at).toBeNull();
});

it('classifies publishing formats into canonical Content Types rather than showing image/text as task categories',async()=>{
 const {publicationContentType}=await import('../plannerPublishing.js');
 expect(publicationContentType({channels:[{format:'image'}]})).toBe('post');
 expect(publicationContentType({channels:[{media_product_type:'REELS'}]})).toBe('reel');
 expect(publicationContentType({channels:[{media_product_type:'STORY'}]})).toBe('story');
});
