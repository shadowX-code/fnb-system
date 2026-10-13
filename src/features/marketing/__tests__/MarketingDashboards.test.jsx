import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MarketingOverview,MarketingSocialAnalytics} from '../MarketingDashboards.jsx';
import {dashboardService} from '../dashboardService.js';
vi.mock('../dashboardService.js',()=>({dashboardService:{operations:vi.fn(),social:vi.fn()}}));
vi.mock('../ContentManagement.jsx',()=>({Thumbnail:()=> <span>Thumbnail</span>}));
vi.mock('recharts',()=>({Area:()=>null,AreaChart:({children})=><div>{children}</div>,Bar:()=>null,BarChart:({children})=><div>{children}</div>,Cell:()=>null,CartesianGrid:()=>null,Legend:()=>null,ResponsiveContainer:({children})=><div>{children}</div>,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}));
const props={organizationId:'org',brandId:'',brands:[{id:'b',name:'Verified Brand'}],can:()=>true,userId:'staff'};
afterEach(()=>{cleanup();vi.clearAllMocks()});
describe('Marketing dashboard responsibilities',()=>{
 it('names distinct growth metrics and preserves observed zero with paired coverage',async()=>{
 dashboardService.social.mockResolvedValue({posts:[],connections:[],growth:{first_observation_date:'2026-10-13',rows:[{channel:'facebook',metric:'views',days:7,growth:0,paired_posts:1,observed_posts:2}]}});
 render(<MarketingSocialAnalytics {...props}/>);await screen.findByRole('heading',{name:'Observed Growth'});
 fireEvent.click(screen.getByRole('button',{name:'Channel'}));fireEvent.click(screen.getByRole('option',{name:'Facebook'}));
 expect(screen.getByText('0 · 1/2 posts')).toBeTruthy();
 for(const label of ['Likes','Reactions','Comments','Shares','Saves'])expect(screen.getByRole('rowheader',{name:label})).toBeTruthy();
 expect(screen.getAllByText('Unavailable · no comparable observations')).toHaveLength(13);
 });
 it('shows genuine operations and scoped actionable record links without successful receipts',async()=>{
 dashboardService.operations.mockResolvedValue({tasks:[],content:[{id:'c',key:'c',brand_id:'b',brand_name:'Verified Brand',title:'Needs review',status:'review',channels:[]},{key:'succeeded',status:'published',channels:[{job_state:'succeeded',provider_post_id:'hidden-id'}]}],conversations:[],unavailable:[]});render(<MarketingOverview {...props}/>);
 const action=await screen.findByRole('link',{name:/Content approval pending/});expect(action.getAttribute('href')).toContain('content_id=c');expect(action.getAttribute('href')).toContain('marketing_brand=b');expect(screen.queryByText('hidden-id')).toBeNull();expect(screen.queryByText('Publishing outcomes')).toBeNull();
 });
 it('makes unavailable sources explicit without inventing zero totals',async()=>{
 dashboardService.operations.mockResolvedValue({tasks:null,content:null,conversations:null,unavailable:[{name:'tasks',reason:'View permission required'}]});render(<MarketingOverview {...props}/>);await screen.findByText('Planner: View permission required');expect(screen.getByRole('button',{name:/Tasks Due/}).textContent).toContain('—');
 });
 it('reports deduplicated social posts with partial coverage and no invented rate',async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const p={id:'post',channel:'instagram',brand_id:'b',provider_account_id:'account',provider_post_id:'post',published_at:day+'T00:00:00Z',observed_at:day+'T01:00:00Z',caption:'Verified content',metrics:{views:0},media:[]};dashboardService.social.mockResolvedValue({posts:[p,{...p,id:'observation'}],connections:[]});render(<MarketingSocialAnalytics {...props}/>);await screen.findByText('Verified content');expect(screen.getByText('1 of 1 posts with data')).toBeTruthy();expect(screen.getByText('Rate not supported')).toBeTruthy();expect(screen.queryByText('Publishing outcomes')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'View post'}));await screen.findByRole('dialog');expect(screen.getByText('Post Detail')).toBeTruthy();
 });
});
