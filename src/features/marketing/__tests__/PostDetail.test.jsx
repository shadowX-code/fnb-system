import { beforeEach,it,expect,vi } from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import PostDetail from '../PostDetail.jsx';
vi.mock('../marketingService.js',()=>({marketingService:{assetUrl:vi.fn().mockResolvedValue('https://private.example/a.jpg'),publicationAvailability:vi.fn().mockResolvedValue({state:'manually_removed',manual_revision:1,manual_confirmation:{state:'confirmed',actor_name:'Reviewer',at:'2026-10-24T10:00:00Z'}})}}));
beforeEach(cleanup);
const content={title:'Actual post',origin:'meta',brand_name:'Idamans',channels:[{channel:'instagram',status:'published',caption:'Real caption',media:[{type:'image',url:'https://scontent.cdninstagram.com/a.jpg'},{type:'video',url:'https://scontent.cdninstagram.com/a.mp4'}],metrics:{reach:0,views:3,interactions:0},unavailable_metrics:{saves:'platform_permission_unavailable'}}]};
it('uses real carousel media with read-only overview and hides technical evidence by default',()=>{
 render(<PostDetail content={content}/>);expect(screen.getByRole('img').getAttribute('src')).toContain('/a.jpg');expect(screen.getByText('Real caption')).toBeTruthy();expect(screen.queryByRole('button',{name:'Send'})).toBeNull();expect(screen.getByText('Technical & synchronization details').parentElement.open).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Next media'}));expect(document.querySelector('video').getAttribute('src')).toContain('/a.mp4');expect(screen.queryByRole('tab',{name:'Audience'})).toBeNull();
});
it('preserves genuine zero and explains permission-denied metrics',()=>{render(<PostDetail content={content}/>);fireEvent.click(screen.getByRole('tab',{name:'Performance'}));expect(screen.getAllByText('0').length).toBeGreaterThan(0);expect(screen.getByText('Permission required')).toBeTruthy();});

it('shows canonical Facebook interactions and keeps per-metric source secondary',()=>{
 const channel={channel:'facebook',status:'published',metrics:{likes:10,reactions:11,interactions:12,shares:1},metric_provenance:{interactions:{source:'insights.post_activity_by_action_type',period:'lifetime',graph_version:'v26.0',observed_at:'2026-10-13T01:09:00Z'}}};
 render(<PostDetail content={{title:'Verified Facebook post',channels:[channel]}}/>);fireEvent.click(screen.getByRole('tab',{name:'Performance'}));expect(screen.getByText('12')).toBeTruthy();expect(screen.getByText(/insights.post_activity_by_action_type/)).toBeTruthy();expect(screen.getByText('Technical & synchronization details').parentElement.open).toBe(false);
});

const fact = label => screen.getByText(label, {selector:'dt'}).nextElementSibling.textContent;
it('shows Scope A Publish Now receipt time separately from unavailable Meta time and has no fake schedule',()=>{
 render(<PostDetail content={{status:'published',scheduled_at:'2026-10-23T16:29:03Z',channels:[{channel:'facebook',status:'published',job_id:'fb',publishing_intention:'now',processing_started_at:'2026-10-23T16:30:03Z',receipt_confirmed_at:'2026-10-23T16:30:07Z',permalink:'https://www.facebook.com/622626120924115/posts/122185797554804842/'}]}}/>);
 expect(fact('Published At')).toBe('Meta timestamp unavailable');
 expect(fact('Scheduled For')).toBe('Publish Now · no schedule');
 expect(fact('Processing Started')).toContain('12:30 am');
 expect(fact('Receipt Confirmed')).toContain('12:30 am');
 expect(fact('Receipt Confirmed')).toContain('not Meta’s publication timestamp');
 expect(screen.getByRole('link',{name:'Open on Facebook'}).getAttribute('href')).toContain('/posts/122185797554804842/');
});
it('keeps the original Scope A Instagram schedule, processing and receipt timestamps distinct',()=>{
 render(<PostDetail content={{status:'published',scheduled_at:'2026-10-23T16:46:19Z',payload:{planned_at:'2026-10-23T16:43:00Z'},channels:[{channel:'instagram',status:'published',job_id:'ig',publishing_intention:'schedule',scheduled_at:'2026-10-23T16:43:00Z',processing_started_at:'2026-10-23T16:45:10Z',receipt_confirmed_at:'2026-10-23T16:47:11Z',provider_post_id:'18150091540612612'}]}}/>);
 expect(fact('Scheduled For')).toContain('12:43 am');expect(fact('Scheduled For')).not.toContain('12:46 am');
 expect(fact('Processing Started')).toContain('12:45 am');expect(fact('Receipt Confirmed')).toContain('12:47 am');
 expect(fact('Published At')).toBe('Meta timestamp unavailable');
 expect(screen.getByText(/Public URL unavailable/)).toBeTruthy();expect(screen.queryByRole('link')).toBeNull();
});
it('switches independent channel results without inheriting a failed sibling or inventing publication',()=>{
 render(<PostDetail content={{status:'failed',channels:[{channel:'facebook',status:'published',actual_at:'2026-10-23T16:30:04Z',receipt_confirmed_at:'2026-10-23T16:30:07Z',permalink:'https://www.facebook.com/123/posts/456/'},{channel:'instagram',status:'failed',job_id:'ig',scheduled_at:'2026-10-23T16:43:00Z'}]}}/>);
 expect(fact('Published At')).toContain('12:30 am');expect(screen.queryByText('Failed')).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Instagram'}));expect(fact('Published At')).toBe('Not published');
 expect(screen.getAllByText('Failed')).toHaveLength(2);expect(screen.queryByText('Receipt Confirmed')).toBeNull();expect(screen.queryByRole('link')).toBeNull();
});
it('never falls back to a retry checkpoint for legacy missing schedule evidence',()=>{
 render(<PostDetail content={{status:'scheduled',scheduled_at:'2026-10-23T16:46:19Z',channels:[{channel:'instagram',status:'scheduled',job_id:'legacy'}]}}/>);
 expect(fact('Scheduled For')).toBe('Schedule evidence unavailable');expect(screen.queryByText('Processing Started')).toBeNull();
});

it('uses the canonical confirmation result immediately in shared Detail facts while keeping Published',async()=>{
 render(<PostDetail canManageAvailability content={{title:'Isolated post',status:'published',channels:[{channel:'facebook',status:'published',connection_id:'conn',provider_post_id:'111_222',availability:{state:'available',manual_revision:0},metrics:{views:17}}]}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Mark as Removed'}));fireEvent.click(screen.getByRole('dialog').querySelector('.btn-primary'));
 await screen.findByText(/Staff confirmation: Reviewer/);
 expect(fact('Live availability')).toContain('Removed · staff confirmed');expect(fact('Live availability')).not.toContain('Live on Meta');expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('tab',{name:'Performance'}));expect(screen.getByText('17')).toBeTruthy();
});
