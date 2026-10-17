import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import BrandTargetCards from '../BrandTargetCards.jsx';
import ContentTypeBadge from '../ContentTypeBadge.jsx';
import {taskStatusAction,listStatusMoves} from '../contentPlanner.js';
afterEach(cleanup);
it.each(['planned','in_progress'])('allows %s reviewer completion/revision without a review hop, preserving edit authority',status=>{
 const task={status,blocked:false};
 expect(taskStatusAction(task,'completed',false,true)).toBe('approve');
 expect(taskStatusAction(task,'revision_needed',true,true)).toBe('request_revision');
 expect(taskStatusAction(task,'completed',true,false)).toBeNull();
 expect(taskStatusAction(task,'revision_needed',true,false)).toBeNull();
 expect(listStatusMoves({...task,blocked:true},true,true)).not.toContain('completed');
});
it('uses five distinct compact category badges rather than workflow-status tones',()=>{
 const {container}=render(<>{['post','reel','story','design','photography'].map(value=><ContentTypeBadge key={value} value={value}/>)}</>);
 expect(container.querySelectorAll('.content-type-badge')).toHaveLength(5);
 expect(new Set([...container.querySelectorAll('.badge')].map(x=>[...x.classList].find(c=>/^badge-/.test(c)))).size).toBe(5);
});
it('bases target progress only on known Published and keeps Scheduled/pipeline secondary',()=>{
 render(<BrandTargetCards targets={[{brand_id:'b',brand_name:'Brand',posts:8,reels:4,published_posts:2,published_reels:0,published_available:true,scheduled_posts:3,scheduled_reels:1,planned_posts:9,planned_reels:7,completed_posts:6,completed_reels:2}]}/>);
 expect(screen.getByRole('progressbar',{name:'Brand posts published target'}).value).toBe(2);
 expect(screen.getByRole('progressbar',{name:'Brand reels published target'}).value).toBe(0);
 expect(screen.getByText('6 remaining')).toBeTruthy();expect(screen.getByText('3 posts · 1 reels')).toBeTruthy();
 expect(screen.queryByRole('button')).toBeNull();
});
it('does not render unavailable publishing as zero or a zero progress bar',()=>{
 render(<BrandTargetCards targets={[{brand_id:'b',brand_name:'Brand',posts:8,reels:4,published_posts:null,published_reels:null,published_available:false,published_coverage:'publication_date_unavailable'}]}/>);
 expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.getByLabelText('Brand posts published').textContent).toBe('—');
 expect(screen.getByText('A confirmed publication is missing its actual date')).toBeTruthy();
});
