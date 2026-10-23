import {useState} from 'react';
import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import PostEditor from '../PostEditor.jsx';
const {service}=vi.hoisted(()=>({service:{metaConfiguration:vi.fn(),integrations:vi.fn(),assetUrl:vi.fn()}}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const brand={id:'brand',organization_id:'org',name:'Real Brand',outlet_ids:[]};
const assets=[{id:'a',organization_id:'org',brand_id:'brand',filename:'Real.jpg',state:'ready',mime_type:'image/jpeg',size_bytes:1024},{id:'b',organization_id:'org',brand_id:'brand',filename:'Second.jpg',state:'ready',mime_type:'image/jpeg',size_bytes:1024}];
const seed={title:'Draft',outlet_ids:[],variants:[{channel:'facebook',format:'text',caption:'FB caption',asset_ids:[]},{channel:'instagram',format:'carousel',caption:'IG caption',asset_ids:['a','b']}]};
function Harness(){const [payload,setPayload]=useState(structuredClone(seed));return <PostEditor payload={payload} onChange={setPayload} brand={brand} assets={assets} onPlannedChange={()=>{}}/>;}
beforeEach(()=>{cleanup();vi.clearAllMocks();service.metaConfiguration.mockResolvedValue({facebook_video_execution_enabled:false});service.integrations.mockResolvedValue({connections:[]});service.assetUrl.mockImplementation(a=>Promise.resolve('https://private.example/'+a.filename));});
it('retains independent channel caption/format/media and copies only on explicit action',async()=>{
 render(<Harness/>);await screen.findByText(/No currently eligible account/);
 fireEvent.change(screen.getByLabelText(/Facebook caption/),{target:{value:'New FB caption'}});
 fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG caption');
 expect(screen.getByRole('button',{name:'Instagram format'}).textContent).toContain('Carousel');
 fireEvent.click(screen.getByRole('button',{name:'Copy caption from Facebook'}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('New FB caption');
 fireEvent.click(screen.getByRole('tab',{name:'Facebook',exact:true}));expect(screen.getByLabelText(/Facebook caption/).value).toBe('New FB caption');
 expect(screen.getByRole('button',{name:'Facebook format'}).textContent).toContain('Text');
});
it('previews real signed media with carousel navigation and editable captions; preview never executes',async()=>{
 render(<Harness/>);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));
 const preview=within(screen.getByRole('article',{name:'Instagram post preview'}));
 await waitFor(()=>expect(preview.getByRole('img').getAttribute('src')).toContain('Real.jpg'));
 fireEvent.click(preview.getByRole('button',{name:'Next media'}));await waitFor(()=>expect(preview.getByRole('img').getAttribute('src')).toContain('Second.jpg'));
 expect(screen.queryByRole('button',{name:/Publish|Authorize external/})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Preview',exact:true}));fireEvent.click(screen.getByRole('tab',{name:'Editor',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG caption');
});
it('does not hide account-read failures or prevent draft edits',async()=>{service.integrations.mockRejectedValue(new Error('Account access unavailable'));render(<Harness/>);await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Retry account check'})).toBeTruthy();expect(screen.getByLabelText(/Facebook caption/).disabled).toBe(false);});

it('reuses one existing MP4 across channels without copying captions or importing duplicate media',async()=>{
 const video={...assets[0],id:'v',filename:'Shared.mp4',mime_type:'video/mp4'};
 function Shared(){const [payload,setPayload]=useState({...seed,variants:[{channel:'facebook',format:'video',caption:'FB independent',asset_ids:[]},{channel:'instagram',format:'reel',caption:'IG independent',asset_ids:['v']}]});return <PostEditor payload={payload} onChange={setPayload} brand={brand} assets={[video]} onPlannedChange={()=>{}}/>;}
 render(<Shared/>);await screen.findByText(/Facebook video execution is disabled/);fireEvent.click(screen.getByRole('button',{name:'Use Instagram video'}));
 expect(screen.getByLabelText(/Facebook caption/).value).toBe('FB independent');expect(screen.getByRole('button',{name:'Remove Shared.mp4'})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG independent');expect(screen.getByRole('button',{name:'Remove Shared.mp4'})).toBeTruthy();
});

it('keeps Stories unavailable without exact verified Business capability while preserving other formats',async()=>{
 render(<Harness/>);await screen.findByText(/No currently eligible account/);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Instagram format'}));
 const story=screen.getByRole('option',{name:'Story · Business verification required'});expect(story.disabled).toBe(true);expect(screen.getByRole('option',{name:'Reel',exact:true}).disabled).toBe(false);
});
