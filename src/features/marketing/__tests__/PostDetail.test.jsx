import { beforeEach,it,expect,vi } from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import PostDetail from '../PostDetail.jsx';
vi.mock('../marketingService.js',()=>({marketingService:{assetUrl:vi.fn().mockResolvedValue('https://private.example/a.jpg')}}));
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
