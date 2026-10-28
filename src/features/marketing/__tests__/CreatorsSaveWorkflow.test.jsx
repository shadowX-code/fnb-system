import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,within,cleanup} from '@testing-library/react';
import CreatorsPage from '../CreatorsPage.jsx';
const {service,notify}=vi.hoisted(()=>({notify:vi.fn(),service:{read:vi.fn(),directory:vi.fn(),command:vi.fn(),preview:vi.fn(),manualPreview:vi.fn()}}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'user'},hasPermission:()=>true})}));
vi.mock('../marketingService.js',()=>({marketingService:{context:async()=>({organizations:[{id:'org'}],brands:[{id:'b',organization_id:'org',name:'Brand',outlets:[]}]})}}));
vi.mock('../creatorService.js',()=>({creatorService:service}));
vi.mock('../MarketingMediaPicker.jsx',()=>({default:()=>null}));
const c={id:'collab',revision:1,brand_id:'b',creator_id:'creator',title:'Mixed collaboration',status:'in_progress',currency:'MYR',cash_cost:5,in_kind_cost:0,cost_state:'estimated',deliverables:[{id:'d1',platform:'instagram',content_type:'image',title:'IG image',status:'pending'},{id:'d2',platform:'tiktok',content_type:'video',title:'Video',status:'pending'}]};
const data={options:[],creators:[{id:'creator',name:'Creator',brand_ids:['b'],categories:[],locations:[]}],accounts:[],collaborations:[c],posts:[],assets:[],snapshots:[],members:[],campaigns:[]};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
beforeEach(()=>{notify.mockReset();localStorage.clear();window.history.replaceState({},'','/');Object.values(service).forEach(f=>f.mockReset());service.read.mockResolvedValue(data);service.directory.mockResolvedValue(data)});
afterEach(cleanup);
async function open(){render(<CreatorsPage ui={{notify}}/>);fireEvent.click(await screen.findByRole('tab',{name:'Collaborations'}));fireEvent.click(await screen.findByRole('button',{name:'View Mixed collaboration'}));return within(screen.getByRole('dialog'))}
it('acknowledges a committed save before workspace refresh and never overwrites later unsaved edits',async()=>{
 const refresh=deferred();service.read.mockResolvedValueOnce(data).mockResolvedValueOnce(data).mockReturnValueOnce(refresh.promise);service.command.mockResolvedValue({...c,revision:2});let drawer=await open();fireEvent.click(drawer.getByRole('button',{name:'Save',exact:true}));await waitFor(()=>expect(notify).toHaveBeenCalledWith({title:'Collaboration saved.',tone:'success'}));expect(screen.queryByText('Saved.')).toBeNull();drawer=within(screen.getByRole('dialog'));await waitFor(()=>expect(drawer.getByRole('button',{name:'Save',exact:true}).disabled).toBe(false));
 fireEvent.change(drawer.getByLabelText('Collaboration Title *'),{target:{value:'Unsaved after save'}});refresh.resolve({...data,collaborations:[{...c,revision:2}]});await waitFor(()=>expect(drawer.getByLabelText('Collaboration Title *').value).toBe('Unsaved after save'));
});
it('retains failed edits, retries the exact request identity, and prevents concurrent submissions',async()=>{
 const pending=deferred();service.command.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({...c,revision:2,title:'Edited'});const drawer=await open();fireEvent.change(drawer.getByLabelText('Collaboration Title *'),{target:{value:'Edited'}});const form=screen.getByRole('dialog').querySelector('form');fireEvent.submit(form);fireEvent.submit(form);expect(service.command).toHaveBeenCalledTimes(1);expect(drawer.getByRole('button',{name:'Saving…'}).disabled).toBe(true);pending.resolve(Promise.reject(new Error('Temporary save failure. Retry.')));await drawer.findByRole('alert');expect(drawer.getByLabelText('Collaboration Title *').value).toBe('Edited');fireEvent.submit(form);await waitFor(()=>expect(service.command).toHaveBeenCalledTimes(2));expect(service.command.mock.calls[0][0].request).toBe(service.command.mock.calls[1][0].request);
});
it('child Post save updates its exact parent plan immediately without waiting for enrichment',async()=>{
 const refresh=deferred();service.read.mockResolvedValueOnce(data).mockResolvedValueOnce(data).mockReturnValueOnce(refresh.promise);service.preview.mockResolvedValue({platform:'instagram',canonical_url:'https://instagram.com/p/real/',metadata_status:'unavailable',message:'Manual details'});service.command.mockImplementation(async intent=>({id:'post',revision:1,brand_id:'b',creator_id:'creator',platform:'instagram',canonical_url:intent.payload.url,collaboration_id:'collab',deliverable_id:intent.payload.deliverable_id,publication_confirmed_at:'2026-10-14T00:00:00Z'}));
 let drawer=await open();fireEvent.click(drawer.getAllByRole('button',{name:'Add Post URL'})[0]);drawer=within(screen.getByRole('dialog'));fireEvent.change(drawer.getByLabelText('Post URL *'),{target:{value:'https://instagram.com/p/real/'}});fireEvent.click(drawer.getByRole('button',{name:'Inspect URL'}));await drawer.findByRole('heading',{name:'Post Preview'});fireEvent.click(drawer.getByRole('button',{name:'Save Post'}));await waitFor(()=>expect(within(screen.getByRole('dialog')).getByText('1/2 Published')).toBeTruthy());expect(within(screen.getByRole('dialog')).getByLabelText('Collaboration Title *').value).toBe('Mixed collaboration');expect(service.command.mock.calls[0][0]).toMatchObject({brand:'b',payload:{creator_id:'creator',collaboration_id:'collab',deliverable_id:'d1',confirm_link:true,confirm_published:true}});
});

it('keeps Grid account links independent from accessible card opening',async()=>{
 service.read.mockResolvedValue({...data,accounts:[{id:'a',creator_id:'creator',platform:'instagram',handle:'alias',profile_url:'https://instagram.com/alias/'}]});render(<CreatorsPage ui={{notify}}/>);const link=await screen.findByRole('link',{name:'Open Instagram profile @alias'});expect(link.closest('button')).toBeNull();fireEvent.click(link);expect(screen.queryByRole('dialog')).toBeNull();fireEvent.keyDown(screen.getByRole('button',{name:'View Creator'}),{key:'Enter'});expect(screen.getByRole('dialog').textContent).toContain('Social Profiles');
});

it('creates a Collaboration with one success toast and keeps the saved drawer open',async()=>{service.command.mockResolvedValue({...c,id:'new',revision:1,title:'New QA'});render(<CreatorsPage ui={{notify}}/>);fireEvent.click(await screen.findByRole('tab',{name:'Collaborations'}));fireEvent.click(await screen.findByRole('button',{name:'New Collaboration'}));const drawer=within(screen.getByRole('dialog'));fireEvent.click(drawer.getByRole('button',{name:'Brand *',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Brand',exact:true}));fireEvent.click(drawer.getByRole('button',{name:'Creator',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Creator',exact:true}));fireEvent.change(drawer.getByLabelText('Collaboration Title *'),{target:{value:'New QA'}});fireEvent.click(drawer.getByRole('button',{name:'Save',exact:true}));await waitFor(()=>expect(notify).toHaveBeenCalledTimes(1));expect(within(screen.getByRole('dialog')).getByLabelText('Collaboration Title *').value).toBe('New QA');expect(screen.queryByText('Saved.')).toBeNull()});
it('clears stale failure feedback after edits without losing the draft',async()=>{service.command.mockRejectedValue(new Error('Revision changed. Reload before saving.'));const drawer=await open();fireEvent.click(drawer.getByRole('button',{name:'Save',exact:true}));await drawer.findByRole('alert');fireEvent.change(drawer.getByLabelText('Collaboration Title *'),{target:{value:'Still editing'}});await waitFor(()=>expect(drawer.queryByRole('alert')).toBeNull());expect(drawer.getByLabelText('Collaboration Title *').value).toBe('Still editing');expect(notify).not.toHaveBeenCalled()});

it('opens a Brand history chip as exact Creator collaboration filtering without opening its profile',async()=>{
 const creator={...data.creators[0],collaboration_history:[{brand_id:'b',collaboration_count:1}]};service.read.mockResolvedValue({...data,creators:[creator,{...creator,id:'other',name:'Other Creator',collaboration_history:[]}],collaborations:[c,{...c,id:'other-collab',creator_id:'other',title:'Other collaboration'}]});
 render(<CreatorsPage ui={{notify}}/>);fireEvent.click(await screen.findByRole('button',{name:'Brand: 1 collaborations'}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('tab',{name:'Collaborations'}).getAttribute('aria-selected')).toBe('true');expect(await screen.findByRole('button',{name:'View Mixed collaboration'})).toBeTruthy();expect(screen.queryByRole('button',{name:'View Other collaboration'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Creator',exact:true}));fireEvent.click(screen.getByRole('option',{name:'All',exact:true}));expect(screen.getByRole('button',{name:'View Other collaboration'})).toBeTruthy();
});

it('loads shared Directory independently from the remembered Brand and filters only actual authorized work',async()=>{
 localStorage.setItem('marketing.creators.user',JSON.stringify({org:'org',brand:'b',view:'grid'}));
 const worked={...data.creators[0],collaboration_history:[{brand_id:'b',collaboration_count:1}]};
 service.read.mockResolvedValue({...data,creators:[worked,{...worked,id:'new-person',name:'Not worked yet',brand_ids:['b'],collaboration_history:[]}]});
 render(<CreatorsPage ui={{notify}}/>);
 await screen.findByRole('button',{name:'View Not worked yet'});
 expect(service.read).toHaveBeenCalledWith('org',null);
 expect(screen.queryByRole('button',{name:'Brand',exact:true})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Worked with Brand'}));fireEvent.click(screen.getByRole('option',{name:'Brand',exact:true}));
 expect(screen.getByRole('button',{name:'View Creator'})).toBeTruthy();expect(screen.queryByRole('button',{name:'View Not worked yet'})).toBeNull();
 expect(service.command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'Collaborations'}));await waitFor(()=>expect(service.read).toHaveBeenCalledWith('org','b'));
 fireEvent.click(screen.getByRole('tab',{name:'Directory'}));await waitFor(()=>expect(service.read.mock.calls.at(-1)).toEqual(['org',null]));
});
it('creates a shared profile without inheriting the remembered Brand',async()=>{
 localStorage.setItem('marketing.creators.user',JSON.stringify({org:'org',brand:'b'}));service.command.mockResolvedValue({id:'new',name:'Shared New',profile_scope:'organization'});
 render(<CreatorsPage ui={{notify}}/>);await screen.findByRole('button',{name:'View Creator'});fireEvent.click(screen.getByRole('button',{name:'Add Creator'}));fireEvent.change(await screen.findByLabelText('Name *'),{target:{value:'Shared New'}});fireEvent.submit(screen.getByRole('dialog').querySelector('form'));
 await waitFor(()=>expect(service.command).toHaveBeenCalledWith(expect.objectContaining({org:'org',brand:null,action:'save_creator'})));
});
it('preserves canonical Post deep links while Directory and commercial scopes are independent',async()=>{
 window.history.replaceState({},'','/?post_id=post&marketing_brand=b');service.read.mockResolvedValue({...data,posts:[{id:'post',brand_id:'b',creator_id:'creator',platform:'instagram',caption:'Linked Post',canonical_url:'https://www.instagram.com/p/Fixture/',latest_metrics:{},revision:1}]});
 render(<CreatorsPage ui={{notify}}/>);await screen.findByRole('dialog');expect(screen.getByRole('tab',{name:'Posts'}).getAttribute('aria-selected')).toBe('true');expect(service.read).toHaveBeenCalledWith('org','b');expect(screen.getByRole('dialog').textContent).toContain('Linked Post');
});

it('keeps Add Creator primary without a standalone Post URL action across Creator sections',async()=>{
 render(<CreatorsPage ui={{notify}}/>);const add=await screen.findByRole('button',{name:'Add Creator',exact:true});expect(add.className).toContain('btn-primary');
 for(const tab of ['Directory','Collaborations','Posts','Insights']){
  fireEvent.click(screen.getByRole('tab',{name:tab,exact:true}));expect(screen.queryByRole('button',{name:'Add Post from URL',exact:true})).toBeNull();expect(screen.getByRole('button',{name:'Add Creator',exact:true})).toBeTruthy();
 }
 expect(service.command).not.toHaveBeenCalled();
});

it('removes standalone Creator-drawer creation while retaining the exact historical Post and Collaboration',async()=>{
 const post={id:'legacy',revision:1,brand_id:'b',creator_id:'creator',platform:'instagram',canonical_url:'https://www.instagram.com/p/legacy/',caption:'Historical standalone evidence',collaboration_id:null};service.read.mockResolvedValue({...data,posts:[post]});
 render(<CreatorsPage ui={{notify}}/>);fireEvent.click(await screen.findByRole('button',{name:'View Creator',exact:true}));const drawer=within(screen.getByRole('dialog'));expect(drawer.queryByRole('button',{name:'Add Post',exact:true})).toBeNull();expect(drawer.getByRole('button',{name:'Plan Visit',exact:true})).toBeTruthy();expect(drawer.getByRole('button',{name:/Mixed collaboration/})).toBeTruthy();
 fireEvent.click(drawer.getByRole('button',{name:/Historical standalone evidence/}));expect(screen.getByRole('heading',{name:'Creator Post',exact:true})).toBeTruthy();expect(screen.getByRole('button',{name:'Save Changes',exact:true})).toBeTruthy();expect(service.command).not.toHaveBeenCalled();expect(post.collaboration_id).toBeNull();
});
it('requires a saved Creator before opening a Collaboration post creation editor',async()=>{
 service.read.mockResolvedValue({...data,collaborations:[{...c,creator_id:null}]});const drawer=await open();fireEvent.click(drawer.getAllByRole('button',{name:'Add Post URL',exact:true})[0]);await screen.findAllByText('Choose and save a Creator for this Collaboration before adding a Post.');expect(screen.queryByRole('heading',{name:'Add Published Post',exact:true})).toBeNull();expect(service.preview).not.toHaveBeenCalled();expect(service.command).not.toHaveBeenCalled();
});
