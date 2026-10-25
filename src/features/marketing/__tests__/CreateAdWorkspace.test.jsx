import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import CreateAdWorkspace from '../CreateAdWorkspace.jsx';
import {createAdConfiguration,newAdForm,reopenAdForm} from '../adsCreateModel.js';
vi.mock('../MarketingMediaPicker.jsx',()=>({default:()=> <span>Shared Media Library / Drive</span>}));
vi.mock('../MarketingMediaPreview.jsx',()=>({default:()=> <span>Verified image preview</span>}));
afterEach(cleanup);
const props={org:'org',brand:'brand',brands:[{id:'brand',name:'Hola'},{id:'other',name:'Other'}],accounts:[{id:'connection',name:'Shared account',health:{timezone:'Asia/Singapore',currency:'MYR',manage_verified:false}}],data:{pages:[{brand_id:'brand',page_id:'123',name:'Hola Page'}],assets:[],source_posts:[{job_id:'job',brand_id:'brand',page_id:'123',caption:'Hola published',format:'image',provider_post_id:'123_456'},{job_id:'other-job',brand_id:'other',page_id:'other-page',caption:'Other Brand private row',format:'image',provider_post_id:'789_111'}]},onClose:vi.fn()};
it('saves an incomplete draft with no advertiser declarations and blocks rapid duplicate clicks',async()=>{
 let complete;const onSave=vi.fn(()=>new Promise(resolve=>{complete=resolve}));render(<CreateAdWorkspace {...props} onSave={onSave}/>);fireEvent.change(screen.getByLabelText('Ad name'),{target:{value:'Local offer'}});const button=screen.getByRole('button',{name:'Save Draft'});fireEvent.click(button);fireEvent.click(button);expect(onSave).toHaveBeenCalledTimes(1);expect(onSave.mock.calls[0][0]).toMatchObject({operation:'create',brandId:'brand',configuration:{draft_only:true,name:'Local offer',workspace:{creative_source:'facebook_post'}}});complete({id:'saved'});await waitFor(()=>expect(button.disabled).toBe(false));
});
it('reopens draft fields, preserves edits on failure and never calls execute',async()=>{
 const previous={id:'draft',brand_id:'brand',connection_id:'connection',configuration:{draft_only:true,workspace:{...newAdForm(),name:'Retained draft',caption:'Retained caption',creative_source:'new_image'}}};const onSave=vi.fn().mockRejectedValue(new Error('Revision changed. Reopen the current revision.'));render(<CreateAdWorkspace {...props} previous={previous} onSave={onSave}/>);expect(screen.getByLabelText('Ad name').value).toBe('Retained draft');fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));await screen.findByRole('alert');expect(screen.getByLabelText('Ad name').value).toBe('Retained draft');expect(onSave.mock.calls[0][0].previousId).toBe('draft');
});
it('keeps source-post selection Brand/Page scoped and shows existing-post limitations',async()=>{
 const form={...newAdForm(),page_id:'123',source_job_id:'job'};render(<CreateAdWorkspace {...props} previous={{id:'draft',brand_id:'brand',connection_id:'connection',configuration:{draft_only:true,workspace:form}}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('tab',{name:'Creative',exact:true}));expect(screen.getByText('Original image post')).toBeTruthy();expect(screen.getByRole('link',{name:'View original post and media'}).href).toBe('https://www.facebook.com/123_456');expect(screen.queryByText('Other Brand private row')).toBeNull();
});
it('shows actual account timezone and shares the existing image/Drive selector',()=>{
 render(<CreateAdWorkspace {...props} accounts={[{...props.accounts[0],health:{timezone:'Asia/Tokyo'}}]} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('tab',{name:'Create New Ad'}));fireEvent.click(screen.getByRole('tab',{name:'Creative',exact:true}));expect(screen.getByText('Shared Media Library / Drive')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Audience',exact:true}));expect(screen.getAllByText('Asia/Tokyo')).toHaveLength(2);
});
it('round-trips local schedule and budget without frontend timezone assumptions',()=>{
 const f={...newAdForm(),name:'Ad',page_id:'123',source_job_id:'job',budget:'49.99',start_local:'2030-01-01T09:00',end_local:'2030-01-02T09:00',latitude:'4.6',longitude:'101.1',universal_beneficiary:'1',universal_payer:'2'};const config=createAdConfiguration(f,[]);expect(config.maximum_budget).toBe(4999);expect(config).not.toHaveProperty('start_time');expect(config.source_job_id).toBe('job');expect(config).not.toHaveProperty('asset_id');expect(reopenAdForm({maximum_budget:4999,configuration:config},'Asia/Tokyo').start_local).toBe(f.start_local);expect(()=>createAdConfiguration({...f,budget:'49.999'},[])).toThrow('two decimal');
});
