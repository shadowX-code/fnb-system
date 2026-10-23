import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import MarketingMediaPicker from '../MarketingMediaPicker.jsx';
const {listing,importFile,uploadFile}=vi.hoisted(()=>({listing:vi.fn(),importFile:vi.fn(),uploadFile:vi.fn()}));
const driveFile={id:'drive-image',selection_id:'shortcut',version:'7',name:'Drive.jpg',mimeType:'image/jpeg'};
const readyAsset={id:'snapshot',filename:'Drive.jpg',state:'ready',mime_type:'image/jpeg',size_bytes:100,source_kind:'drive',source_metadata:{selection_id:'shortcut',version:'7'}};
vi.mock('../driveService.js',()=>({driveService:{import:importFile,upload:uploadFile}}));
vi.mock('../marketingService.js',()=>({marketingService:{listing}}));
vi.mock('../DriveMediaBrowser.jsx',()=>({default:({onSelect,isSelected})=><><button onClick={()=>onSelect(driveFile)} aria-pressed={isSelected(driveFile)}>Drive image</button><button onClick={()=>onSelect({...driveFile,id:'pdf',selection_id:'pdf',mimeType:'application/pdf'})}>Unsupported file</button></>}));
vi.mock('../MarketingMediaPreview.jsx',()=>({default:({asset})=><span>{asset.filename}</span>}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('keeps a failed inline unlink for retry without uploading, importing or deleting the asset',async()=>{
 const save=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce({revision:2});
 render(<MarketingMediaPicker brand={{id:'brand',organization_id:'org'}} attachments values={['snapshot']} assets={[readyAsset]} onChange={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Remove Drive.jpg'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry media save'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
 expect(save.mock.calls).toEqual([[[]],[[]]]);expect(importFile).not.toHaveBeenCalled();expect(uploadFile).not.toHaveBeenCalled();
});
it('uses the canonical total_count to reach and select saved media after the first page',async()=>{
 const asset=n=>({id:`asset-${n}`,filename:`Image ${n}`,state:'ready',mime_type:'image/jpeg',size_bytes:100});
 listing.mockResolvedValueOnce({rows:Array.from({length:20},(_,i)=>asset(i+1)),total_count:21,page:1,page_size:20}).mockResolvedValueOnce({rows:[asset(21)],total_count:21,page:2,page_size:20});
 const selected=vi.fn();
 render(<MarketingMediaPicker brand={{id:'brand',organization_id:'org'}} format="image" channel="facebook" onChange={selected} initialOpen/>);
 fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));
 await screen.findByText('Image 1');
 const next=screen.getAllByRole('button',{name:'Next',exact:true}).find(button=>!button.disabled);
 expect(next).toBeTruthy();fireEvent.click(next);
 await screen.findByText('Image 21');
 await waitFor(()=>expect(listing).toHaveBeenLastCalledWith({organizationId:'org',brandId:'brand',kind:'assets',page:2,pageSize:20}));
 fireEvent.click(screen.getByRole('button',{name:'Select Image 21'}));expect(selected).not.toHaveBeenCalled();expect(screen.getByText('1 selected')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(selected).toHaveBeenCalledWith(['asset-21']));
});

const picker=props=><MarketingMediaPicker brand={{id:'brand',organization_id:'org'}} channel="facebook" format="carousel" initialOpen {...props}/>;
it('toggles Drive selection locally, confirms once and waits for task persistence',async()=>{
 let finish;importFile.mockResolvedValue(readyAsset);const save=vi.fn(()=>new Promise(resolve=>{finish=resolve}));render(picker({onChange:save}));
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));expect(screen.getByText('1 selected')).toBeTruthy();expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));expect(screen.getByText('0 selected')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Drive image'}));expect(importFile).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(['snapshot']));expect(screen.getByRole('heading',{name:'Select media'})).toBeTruthy();expect(screen.getByRole('button',{name:'Saving…'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(importFile).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(1);
 await act(async()=>finish({revision:2}));expect(screen.queryByRole('heading',{name:'Select media'})).toBeNull();expect(importFile).toHaveBeenCalledWith('org','brand',driveFile,'facebook');
});
it.each([false,new Error('Task changed. Reload and retry.')])('keeps selection after save failure and retries without importing another snapshot (%s)',async failure=>{
 importFile.mockResolvedValue(readyAsset);const save=vi.fn().mockImplementationOnce(()=>failure instanceof Error?Promise.reject(failure):failure).mockResolvedValueOnce({revision:2});render(picker({onChange:save}));fireEvent.click(screen.getByRole('button',{name:'Drive image'}));fireEvent.click(screen.getByRole('button',{name:'Done'}));await screen.findByRole('alert');expect(screen.getByText('1 selected')).toBeTruthy();expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(screen.queryByRole('heading',{name:'Select media'})).toBeNull());expect(importFile).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(2);
});
it('retains selection on expired Drive access and rejects unsupported files before importing',async()=>{
 importFile.mockRejectedValue(new Error('Reconnect Google Drive.'));const save=vi.fn();render(picker({onChange:save}));fireEvent.click(screen.getByRole('button',{name:'Unsupported file'}));expect(screen.getByRole('alert').textContent).toContain('Choose an image');expect(screen.getByText('0 selected')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Drive image'}));fireEvent.click(screen.getByRole('button',{name:'Done'}));await screen.findByText('Reconnect Google Drive.');expect(screen.getByText('1 selected')).toBeTruthy();expect(save).not.toHaveBeenCalled();
});
it('preserves a saved Drive reference and prevents duplicate attachment across sources',async()=>{
 importFile.mockResolvedValue(readyAsset);const save=vi.fn();render(picker({onChange:save,values:['snapshot'],assets:[readyAsset]}));expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(['snapshot']));expect(importFile).not.toHaveBeenCalled();
});
it('uses canonical device upload and commits only on Done',async()=>{
 uploadFile.mockResolvedValue(readyAsset);const save=vi.fn();render(picker({onChange:save}));fireEvent.click(screen.getByRole('tab',{name:'Upload from device'}));const file=new File(['image'],'Upload.jpg',{type:'image/jpeg'});fireEvent.change(screen.getByLabelText('Upload post media'),{target:{files:[file]}});await screen.findByText('1 selected');expect(uploadFile).toHaveBeenCalledWith('org','brand',file,'facebook');expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(['snapshot']));
});
it('does not attach an in-flight import after the Brand changes',async()=>{
 let finish;importFile.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const save=vi.fn();const view=render(picker({onChange:save}));fireEvent.click(screen.getByRole('button',{name:'Drive image'}));fireEvent.click(screen.getByRole('button',{name:'Done'}));view.rerender(picker({brand:{id:'other',organization_id:'org'},onChange:save}));await act(async()=>finish(readyAsset));expect(save).not.toHaveBeenCalled();expect(screen.getByText('0 selected')).toBeTruthy();
});
it('shares selected state and deselection between Drive and Existing FeedX media',async()=>{
 listing.mockResolvedValue({rows:[readyAsset],total_count:1});const save=vi.fn();render(picker({onChange:save}));
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));
 fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));
 const selected=await screen.findByRole('button',{name:'Remove Drive.jpg'});
 expect(selected.getAttribute('aria-pressed')).toBe('true');expect(selected.textContent).toBe('Selected');expect(selected.closest('article').className).toContain('is-selected');expect(screen.getByText('1 selected')).toBeTruthy();
 fireEvent.click(selected);expect(screen.getByText('0 selected')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Google Drive'}));expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('false');
 fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));fireEvent.click(await screen.findByRole('button',{name:'Select Drive.jpg'}));expect(screen.getByText('1 selected')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Google Drive'}));expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith(['snapshot']));expect(importFile).not.toHaveBeenCalled();
});
it('keeps one selected Drive identity through source switches, failed save and retry',async()=>{
 listing.mockResolvedValue({rows:[readyAsset],total_count:1});importFile.mockResolvedValue(readyAsset);const save=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce({revision:2});render(picker({onChange:save}));
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));await screen.findByRole('button',{name:'Remove Drive.jpg'});
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await screen.findByRole('alert');expect(screen.getByText('1 selected')).toBeTruthy();expect(screen.getByRole('button',{name:'Remove Drive.jpg'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('tab',{name:'Google Drive'}));expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(screen.queryByRole('heading',{name:'Select media'})).toBeNull());expect(importFile).toHaveBeenCalledTimes(1);expect(save.mock.calls).toEqual([[['snapshot']],[['snapshot']]]);
});

it('does not confuse a historical Drive snapshot with the current file version',async()=>{
 const older={...readyAsset,id:'older',filename:'Older Drive.jpg',source_metadata:{...readyAsset.source_metadata,version:'6'}};
 listing.mockResolvedValue({rows:[readyAsset,older],total_count:2});const save=vi.fn();render(picker({onChange:save,assets:[readyAsset,older]}));
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));expect((await screen.findByRole('button',{name:'Remove Drive.jpg'})).getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('button',{name:'Select Older Drive.jpg'}).getAttribute('aria-pressed')).toBe('false');expect(screen.getByText('1 selected')).toBeTruthy();
});
it('a saved older snapshot does not preselect a newer Drive version',()=>{
 const older={...readyAsset,id:'older',source_metadata:{...readyAsset.source_metadata,version:'6'}};render(picker({onChange:vi.fn(),values:['older'],assets:[older]}));expect(screen.getByRole('button',{name:'Drive image'}).getAttribute('aria-pressed')).toBe('false');expect(screen.getByText('1 selected')).toBeTruthy();
});

it('allows mixed image, video and PDF references for a Reel task without publishing restrictions',async()=>{
 const video={...readyAsset,id:'video',filename:'Reference.mp4',mime_type:'video/mp4',source_kind:'device',size_bytes:60000000};
 const pdf={...video,id:'pdf',filename:'Brief.pdf',mime_type:'application/pdf'};
 listing.mockResolvedValue({rows:[readyAsset,video,pdf],total_count:3});const save=vi.fn();
 render(picker({attachments:true,format:'reel',onChange:save}));
 fireEvent.click(screen.getByRole('button',{name:'Drive image'}));
 fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));
 fireEvent.click(await screen.findByRole('button',{name:'Select Reference.mp4'}));fireEvent.click(screen.getByRole('button',{name:'Select Brief.pdf'}));
 expect(screen.getByText('3 selected')).toBeTruthy();expect(screen.getByRole('button',{name:'Remove Drive.jpg'}).getAttribute('aria-pressed')).toBe('true');
 importFile.mockResolvedValue(readyAsset);fireEvent.click(screen.getByRole('button',{name:'Done'}));
 await waitFor(()=>expect(save).toHaveBeenCalledExactlyOnceWith(['snapshot','video','pdf']));
 expect(importFile).toHaveBeenCalledWith('org','brand',driveFile,undefined);
});
it('keeps Publishing Reel selection MP4-only and single-select',async()=>{
 const video={...readyAsset,id:'video',filename:'Publish.mp4',mime_type:'video/mp4',source_kind:'device'};
 listing.mockResolvedValue({rows:[readyAsset,video,{...video,id:'pdf',mime_type:'application/pdf'}],total_count:3});
 render(picker({format:'reel',onChange:vi.fn()}));fireEvent.click(screen.getByRole('button',{name:'Drive image'}));expect(screen.getByText('0 selected')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'Existing FeedX media'}));await screen.findByRole('button',{name:'Select Publish.mp4'});
 expect(screen.queryByRole('button',{name:'Select Drive.jpg'})).toBeNull();expect(screen.getAllByRole('button',{name:/^Select .*mp4$/})).toHaveLength(1);
});
it('uploads PDF task references without a publishing channel and keeps failed saves retryable',async()=>{
 const pdf={...readyAsset,id:'pdf',filename:'Brief.pdf',mime_type:'application/pdf',source_kind:'device'};
 uploadFile.mockResolvedValue(pdf);const save=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
 render(picker({attachments:true,format:'reel',onChange:save}));fireEvent.click(screen.getByRole('tab',{name:'Upload from device'}));
 const input=screen.getByLabelText('Upload task attachment');expect(input.accept).toContain('application/pdf');expect(input.accept).toContain('image/png');expect(input.accept).toContain('video/mp4');
 const file=new File(['%PDF-1.7'],'Brief.pdf',{type:'application/pdf'});fireEvent.change(input,{target:{files:[file]}});await screen.findByText('1 selected');
 expect(uploadFile).toHaveBeenCalledWith('org','brand',file,undefined);fireEvent.click(screen.getByRole('button',{name:'Done'}));await screen.findByRole('alert');expect(screen.getByText('1 selected')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(screen.queryByRole('heading',{name:'Select media'})).toBeNull());expect(uploadFile).toHaveBeenCalledTimes(1);
});

it('reorders carousel media through the existing association callback without reimporting',async()=>{
 const asset=readyAsset,brand={id:'brand',organization_id:'org'};const onChange=vi.fn().mockResolvedValue(undefined);render(<MarketingMediaPicker brand={brand} format="carousel" channel="instagram" values={['snapshot','second']} assets={[asset,{...asset,id:'second',filename:'Second.jpg'}]} onChange={onChange}/>);
 fireEvent.click(screen.getByRole('button',{name:`Move ${asset.filename} later`}));await waitFor(()=>expect(onChange).toHaveBeenCalledWith(['second','snapshot']));expect(importFile).not.toHaveBeenCalled();
});
