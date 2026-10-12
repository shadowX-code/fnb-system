import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import CampaignMediaField from '../CampaignMediaField.jsx';
const {service}=vi.hoisted(()=>({service:{upload:vi.fn(),assetUrl:vi.fn()}}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const asset={id:'existing',filename:'actual.jpg',mime_type:'image/jpeg',size_bytes:100,object_path:'existing/path'};
beforeEach(()=>{vi.clearAllMocks();service.assetUrl.mockResolvedValue('https://example.test/private-existing.jpg');URL.createObjectURL=vi.fn(()=> 'blob:test-image');URL.revokeObjectURL=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({close:vi.fn()}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(props={}){const onChange=vi.fn(),onUploaded=vi.fn(),onBusy=vi.fn();render(<CampaignMediaField org="o" brand="b" assets={[asset]} assetId="existing" onChange={onChange} onUploaded={onUploaded} onBusy={onBusy} canUpload busy={false} {...props}/>);return {onChange,onUploaded,onBusy};}
describe('Campaign media uses immutable existing storage',()=>{
 it('previews selected real media and removes only the draft selection',async()=>{const {onChange}=mount();expect((await screen.findByRole('img',{name:'actual.jpg'})).src).toBe('https://example.test/private-existing.jpg');fireEvent.click(screen.getByRole('button',{name:'Remove campaign image'}));expect(onChange).toHaveBeenCalledWith('');expect(service.upload).not.toHaveBeenCalled();});
 it('validates file format and does not upload unsupported media',async()=>{mount();fireEvent.change(screen.getByLabelText('Upload campaign image'),{target:{files:[new File(['x'],'video.mp4',{type:'video/mp4'})]}});await screen.findByRole('alert');expect(service.upload).not.toHaveBeenCalled();});
 it('decodes and uploads a replacement as a new asset, retaining the original',async()=>{const uploaded={...asset,id:'new',filename:'new.png'};service.upload.mockResolvedValue(uploaded);const {onChange,onUploaded,onBusy}=mount();const file=new File(['png'],'new.png',{type:'image/png'});fireEvent.change(screen.getByLabelText('Upload campaign image'),{target:{files:[file]}});await waitFor(()=>expect(onChange).toHaveBeenCalledWith('new'));expect(service.upload).toHaveBeenCalledWith('o','b',file);expect(onUploaded).toHaveBeenCalledWith(uploaded);expect(onBusy.mock.calls).toEqual([[true],[false]]);expect(asset.id).toBe('existing');});
 it('does not upload undecodable image bytes or replace the previous selection',async()=>{vi.stubGlobal('createImageBitmap',vi.fn().mockRejectedValue(new Error('decode')));const {onChange}=mount();fireEvent.change(screen.getByLabelText('Upload campaign image'),{target:{files:[new File(['bad'],'bad.png',{type:'image/png'})]}});await screen.findByRole('alert');expect(service.upload).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();});
});
