import {useState} from 'react';
import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import PostEditor from '../PostEditor.jsx';
const {service}=vi.hoisted(()=>({service:{metaConfiguration:vi.fn(),integrations:vi.fn(),assetUrl:vi.fn(),captionLibrary:vi.fn()}}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const brand={id:'brand',organization_id:'org',name:'Real Brand',outlet_ids:[]};
const assets=[{id:'a',organization_id:'org',brand_id:'brand',filename:'Real.jpg',state:'ready',mime_type:'image/jpeg',size_bytes:1024},{id:'b',organization_id:'org',brand_id:'brand',filename:'Second.jpg',state:'ready',mime_type:'image/jpeg',size_bytes:1024}];
const seed={title:'Draft',outlet_ids:[],variants:[{channel:'facebook',format:'text',caption:'FB caption',asset_ids:[]},{channel:'instagram',format:'carousel',caption:'IG caption',asset_ids:['a','b']}]};
function Harness(){const [payload,setPayload]=useState(structuredClone(seed));return <PostEditor payload={payload} onChange={setPayload} brand={brand} assets={assets} onPlannedChange={()=>{}} can={()=>true}/>;}
beforeEach(()=>{cleanup();vi.clearAllMocks();service.metaConfiguration.mockResolvedValue({facebook_video_execution_enabled:false});service.integrations.mockResolvedValue({connections:[]});service.captionLibrary.mockResolvedValue({rows:[{id:'saved',body:'Inserted',active:true}],total_count:1});service.assetUrl.mockImplementation(a=>Promise.resolve('https://private.example/'+a.filename));});
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
 function Shared(){const [payload,setPayload]=useState({...seed,variants:[{channel:'facebook',format:'video',caption:'FB independent',asset_ids:[]},{channel:'instagram',format:'reel',caption:'IG independent',asset_ids:['v']}]});return <PostEditor payload={payload} onChange={setPayload} brand={brand} assets={[video]} onPlannedChange={()=>{}} can={()=>true}/>;}
 render(<Shared/>);await screen.findByText(/Facebook video execution is disabled/);fireEvent.click(screen.getByRole('button',{name:'Use Instagram video'}));
 expect(screen.getByLabelText(/Facebook caption/).value).toBe('FB independent');expect(screen.getByRole('button',{name:'Remove Shared.mp4'})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG independent');expect(screen.getByRole('button',{name:'Remove Shared.mp4'})).toBeTruthy();
});

it('keeps Stories unavailable independently of Business capability while preserving other formats',async()=>{
 render(<Harness/>);await screen.findByText(/No currently eligible account/);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Instagram format'}));
 const story=screen.getByRole('option',{name:'Story · execution disabled'});expect(story.disabled).toBe(true);expect(screen.getByRole('option',{name:'Reel',exact:true}).disabled).toBe(false);
});

it('uses independent accessible channel chips and restores deselected variants with media and draft text',async()=>{render(<Harness/>);await screen.findByText(/No currently eligible account/);const fb=screen.getByRole('button',{name:'Facebook',exact:true}),ig=screen.getByRole('button',{name:'Instagram',exact:true});expect(fb.getAttribute('aria-pressed')).toBe('true');fireEvent.click(ig);expect(screen.queryByRole('tab',{name:'Instagram',exact:true})).toBeNull();fireEvent.click(ig);expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG caption');expect(screen.getByRole('button',{name:'Remove Real.jpg'})).toBeTruthy();fireEvent.click(fb);fireEvent.click(ig);expect(screen.queryByRole('group',{name:'Caption saved text'})).toBeNull();fireEvent.click(fb);expect(screen.getByLabelText(/Facebook caption/).value).toBe('FB caption');});
it('inserts at the active channel cursor, preserves both surrounding text and the other channel draft',async()=>{render(<Harness/>);await screen.findByText(/No currently eligible account/);const input=screen.getByLabelText(/Facebook caption/);input.focus();input.setSelectionRange(2,5);fireEvent.select(input);fireEvent.click(screen.getByRole('button',{name:'Templates',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'Insert Inserted'}));expect(screen.getByLabelText(/Facebook caption/).value).toBe('FB\n\nInserted caption');expect(screen.getByLabelText(/Facebook caption/).selectionStart).toBe(12);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('IG caption');expect(screen.getAllByRole('group',{name:'Caption saved text'})).toHaveLength(1);});
it('separates Publishing Plan intentions and never calls execution or changes production due dates',async()=>{render(<Harness/>);await screen.findByText(/No currently eligible account/);expect(screen.getByRole('radio',{name:'Save Draft'}).checked).toBe(true);expect(screen.queryByLabelText('Publishing date & time date')).toBeNull();fireEvent.click(screen.getByRole('radio',{name:'Schedule'}));expect(screen.getByLabelText('Publishing date & time date')).toBeTruthy();fireEvent.click(screen.getByRole('radio',{name:'Publish Now'}));expect(screen.queryByLabelText('Publishing date & time date')).toBeNull();expect(screen.getByText(/Nothing sends until confirmation/)).toBeTruthy();});

it('never duplicates caption toolbars after repeated selection and tab switching',async()=>{render(<Harness/>);await screen.findByText(/No currently eligible account/);for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('tab',{name:'Facebook',exact:true}));expect(screen.getAllByRole('button',{name:'Templates',exact:true})).toHaveLength(1);expect(screen.getAllByRole('button',{name:'Hashtags',exact:true})).toHaveLength(1);expect(screen.getByLabelText(/Facebook caption/).value).toBe('FB caption');}});

it.each([['facebook','video','facebook_video'],['facebook','reel','facebook_reel'],['instagram','carousel','instagram_mixed_carousel']])('normal-mode %s/%s readiness uses current format eligibility without a routine grant',async(channel,format,key)=>{
 const video={...assets[0],id:'vid',filename:'Shared.mp4',mime_type:'video/mp4'};service.metaConfiguration.mockResolvedValue({normal_format_execution_enabled:true});service.integrations.mockResolvedValue({connections:[{organization_id:'org',brand_id:'brand',channel,status:'test_authorized',expires_at:'2099-01-01T00:00:00Z',format_authorizations:{normal_formats:[key]},capabilities:{publishing:true,execution_enabled:true,formats:[format]}}]});
 render(<PostEditor payload={{...seed,variants:[{channel,format,caption:'Independent',asset_ids:format==='carousel'?['a','vid']:['vid']}]}} onChange={vi.fn()} brand={brand} assets={[...assets,video]} onPlannedChange={()=>{}} can={()=>true}/>);await screen.findByText('Format available for the current publishing account.');expect(screen.queryByText(/separate format authorization/i)).toBeNull();
});

it('reports configuration failures as unavailable readiness rather than an account-format restriction',async()=>{
 service.metaConfiguration.mockRejectedValue(new Error('Unavailable'));render(<Harness/>);expect(await screen.findByText(/Publishing readiness could not be checked/)).toBeTruthy();expect(screen.getByRole('button',{name:'Retry publishing check'})).toBeTruthy();expect(screen.getByLabelText(/Facebook caption/).disabled).toBe(false);
 service.metaConfiguration.mockResolvedValue({normal_format_execution_enabled:true});fireEvent.click(screen.getByRole('button',{name:'Retry publishing check'}));await waitFor(()=>expect(screen.queryByText(/Publishing readiness could not be checked/)).toBeNull());
});

function CopyHarness({initial,records=assets,onPayload=()=>{}}){const [payload,setPayload]=useState(initial),[saved,setSaved]=useState(null);return <><PostEditor payload={payload} onChange={next=>{setPayload(next);onPayload(next)}} brand={brand} assets={records} onPlannedChange={()=>{}} can={()=>true}/><button onClick={()=>setSaved(structuredClone(payload))}>Save test revision</button><button onClick={()=>setPayload(structuredClone(saved))}>Reopen test revision</button><button onClick={()=>setPayload(p=>({...p,title:p.title+' changed',variants:p.variants.map(v=>v.channel==='facebook'?{...v,asset_ids:[...v.asset_ids].reverse()}:v)}))}>Concurrent source edit</button></>}
const mediaSeed={...seed,variants:[{channel:'facebook',format:'carousel',caption:'Keep FB',asset_ids:['b','a']},{channel:'instagram',format:'carousel',caption:'Keep IG',asset_ids:[]}]};
it('copies exact media order, immediately previews it and keeps channel edits independent through save/reopen',async()=>{
 const onPayload=vi.fn();render(<CopyHarness initial={mediaSeed} onPayload={onPayload}/>);await screen.findByText(/No currently eligible account/);
 fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Copy media from Facebook'}));
 expect(onPayload.mock.lastCall[0].variants[1]).toEqual({...mediaSeed.variants[1],asset_ids:['b','a']});
 const preview=within(screen.getByRole('article',{name:'Instagram post preview'}));await waitFor(()=>expect(preview.getByRole('img').getAttribute('src')).toContain('Second.jpg'));
 fireEvent.click(screen.getByRole('button',{name:'Move Second.jpg later'}));await waitFor(()=>expect(onPayload.mock.lastCall[0].variants[1].asset_ids).toEqual(['a','b']));
 await waitFor(()=>expect(preview.getByRole('img').getAttribute('src')).toContain('Real.jpg'));
 fireEvent.click(screen.getByRole('button',{name:'Save test revision'}));fireEvent.click(screen.getByRole('tab',{name:'Facebook',exact:true}));
 expect(onPayload.mock.lastCall[0].variants[0].asset_ids).toEqual(['b','a']);fireEvent.click(screen.getByRole('button',{name:'Reopen test revision'}));fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));expect(screen.getByLabelText(/Instagram caption/).value).toBe('Keep IG');
 expect(screen.getByRole('button',{name:'Instagram format'}).textContent).toContain('Carousel');await waitFor(()=>expect(preview.getByRole('img').getAttribute('src')).toContain('Real.jpg'));
});
it('confirms before replacing Instagram media, supports cancellation and refuses a changed source confirmation',async()=>{
 const onPayload=vi.fn(),initial={...mediaSeed,variants:mediaSeed.variants.map(v=>v.channel==='instagram'?{...v,asset_ids:['a','b']}:v)};
 render(<CopyHarness initial={initial} onPayload={onPayload}/>);await screen.findByText(/No currently eligible account/);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Copy media from Facebook'}));expect(onPayload).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));expect(onPayload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Copy media from Facebook'}));fireEvent.click(screen.getByRole('button',{name:'Concurrent source edit'}));fireEvent.click(screen.getByRole('button',{name:'Replace media',exact:true}));expect(onPayload).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('changed');
 fireEvent.click(screen.getByRole('button',{name:'Copy media from Facebook'}));fireEvent.click(screen.getByRole('button',{name:'Replace media',exact:true}));expect(onPayload.mock.lastCall[0].variants[1].asset_ids).toEqual(['a','b']);
});
it('reports incompatible Facebook selections without dropping items, replacing media or changing Instagram format',async()=>{
 const initial={...mediaSeed,variants:mediaSeed.variants.map(v=>v.channel==='instagram'?{...v,format:'image',asset_ids:[]}:v)},onPayload=vi.fn();
 render(<CopyHarness initial={initial} onPayload={onPayload}/>);await screen.findByText(/No currently eligible account/);fireEvent.click(screen.getByRole('tab',{name:'Instagram',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Copy media from Facebook'}));expect(screen.getByRole('alert').textContent).toContain('Choose one');expect(onPayload).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Instagram format'}).textContent).toContain('Image');
 fireEvent.click(screen.getByRole('button',{name:'Instagram format'}));fireEvent.click(screen.getByRole('option',{name:'Carousel',exact:true}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
