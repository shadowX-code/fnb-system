import {useState} from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import ReelCoverEditor from '../ReelCoverEditor.jsx';
const {source,frame}=vi.hoisted(()=>({source:vi.fn(),frame:vi.fn()}));
vi.mock('../marketingService.js',()=>({marketingService:{assetUrl:source}}));
vi.mock('../videoCoverFrame.js',()=>({videoCoverFrame:frame}));
vi.mock('../MarketingMediaPicker.jsx',()=>({default:({onChange,onAssetsResolved})=><button type="button" onClick={()=>{onAssetsResolved?.([assets[1]]);onChange([assets[1].id]);}}>Choose fixture cover</button>}));
const video='00000000-0000-4000-8000-000000000001',image='00000000-0000-4000-8000-000000000002';
const assets=[{id:video,state:'ready',filename:'Fixture.mp4'},{id:image,state:'ready',filename:'Cover.jpg'}],brand={id:'brand',organization_id:'org'};
function Harness({channel='instagram',onChange=()=>{}}){const [variant,setVariant]=useState({channel,format:'reel',asset_ids:[video]});return <><ReelCoverEditor variant={variant} brand={brand} assets={assets} onChange={cover=>{onChange(cover);setVariant(v=>({...v,reel_cover:cover}));}}/><output data-testid="cover">{JSON.stringify(variant.reel_cover)}</output></>;}
beforeEach(()=>{cleanup();vi.clearAllMocks();vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:fixture-frame');static revokeObjectURL=vi.fn();});source.mockImplementation(a=>Promise.resolve('https://private.example/'+a.filename));frame.mockResolvedValue({blob:new Blob(['fixture']),metadata:{width:540,height:960,duration:5}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows independent Instagram frame/image controls and clearly qualified placement previews',async()=>{
 render(<Harness/>);const controls=within(screen.getByRole('tablist',{name:'Instagram cover source'}));fireEvent.click(controls.getByRole('tab',{name:'Video frame'}));
 fireEvent.change(screen.getByLabelText(/Frame time/),{target:{value:'2.4'}});await waitFor(()=>expect(frame).toHaveBeenCalledWith('https://private.example/Fixture.mp4',2400,expect.any(AbortSignal)));
 expect(screen.getByTestId('cover').textContent).toContain('"offset_ms":2400');expect(screen.getByText(/Meta controls final placement/)).toBeTruthy();expect(screen.getByAltText('Profile grid cover preview').getAttribute('src')).toBe('blob:fixture-frame');
 fireEvent.click(controls.getByRole('tab',{name:'Custom image'}));fireEvent.click(screen.getByRole('button',{name:'Choose fixture cover'}));await waitFor(()=>expect(screen.getByAltText('Reel cover preview').getAttribute('src')).toContain('Cover.jpg'));expect(screen.getByTestId('cover').textContent).toContain(image);expect(screen.getByTestId('cover').textContent).not.toContain('offset_ms');
});
it('keeps Facebook provider-selected without exposing unsupported options',async()=>{render(<Harness channel="facebook"/>);expect(screen.queryByRole('tablist',{name:'Instagram cover source'})).toBeNull();expect(screen.queryByRole('button',{name:'Choose fixture cover'})).toBeNull();expect(screen.getByText(/Facebook selects the published cover/)).toBeTruthy();});
it('discards a late frame result after cover source changes and never mutates the saved payload during preview',async()=>{
 let resolve;frame.mockImplementation(()=>new Promise(r=>{resolve=r}));const changes=vi.fn();render(<Harness onChange={changes}/>);await waitFor(()=>expect(frame).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('tab',{name:'Custom image'}));fireEvent.click(screen.getByRole('button',{name:'Choose fixture cover'}));await waitFor(()=>expect(screen.getByAltText('Reel cover preview').getAttribute('src')).toContain('Cover.jpg'));
 resolve({blob:new Blob(['late']),metadata:{width:540,height:960,duration:5}});await Promise.resolve();expect(screen.getByAltText('Reel cover preview').getAttribute('src')).toContain('Cover.jpg');expect(changes).toHaveBeenCalledTimes(2);
});
it('keeps preview errors actionable without sending or losing cover selection',async()=>{frame.mockRejectedValue(new Error('Frame outside video.'));render(<Harness/>);await screen.findByText('Frame outside video.');expect(screen.getByRole('button',{name:'Retry preview'})).toBeTruthy();expect(screen.getByTestId('cover').textContent).toBe('');expect(screen.queryByRole('button',{name:/Publish|Send/})).toBeNull();});
