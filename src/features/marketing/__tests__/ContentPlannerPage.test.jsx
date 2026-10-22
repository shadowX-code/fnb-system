import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within,act} from '@testing-library/react';
import ContentPlannerPage from '../ContentPlannerPage.jsx';
const {planner,marketing,auth,media}=vi.hoisted(()=>({media:{props:null},planner:{command:vi.fn(),read:vi.fn(),order:vi.fn()},marketing:{context:vi.fn(),assetUrl:vi.fn(),plannerPublishing:vi.fn()},auth:{user:{id:'planner-user'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../plannerService.js',()=>({plannerService:planner}));vi.mock('../marketingService.js',()=>({marketingService:marketing}));vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,ariaLabel,value,onChange,options,disabled})=><label>{label}<select aria-label={ariaLabel||label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
vi.mock('../MarketingMediaPicker.jsx',()=>({default:props=>{media.props=props;return null}}));
const task={id:'task',organization_id:'org',brand_id:'brand',brand_name:'Brand',title:'Real task',content_type:'post',due_date:'2026-10-12',planned_week:'2026-10-12',planned_publish_date:null,priority:'normal',brief:'Approved factual brief',reference_links:[],asset_ids:[],assets:[],history:[],status:'planned',blocked:false,blocker_reason:'',revision:1,manual_order:1,created_at:'2026-10-12'};
const read={tasks:[task],members:[],targets:[],templates:[],drafts:[]};
beforeEach(()=>{cleanup();localStorage.clear();window.history.replaceState({},'','/marketing/planner');vi.clearAllMocks();marketing.plannerPublishing.mockResolvedValue({rows:[],total_count:0});marketing.assetUrl.mockResolvedValue('https://example.com/preview.jpg');auth.hasPermission.mockImplementation(()=>true);marketing.context.mockResolvedValue({organizations:[{id:'org',name:'Org'}],brands:[{id:'brand',organization_id:'org',name:'Brand'}]});planner.read.mockResolvedValue(read);let current=read;planner.command.mockImplementation(async c=>{if(c.action==='save'){current={...current,tasks:current.tasks.map(t=>t.id===c.id?{...t,...c.payload,revision:t.revision+1}:t)};planner.read.mockResolvedValue(current);}return {}});});
it('defaults to All Brands and shares real task records across views',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');expect(screen.getByRole('combobox',{name:'Brand'}).value).toBe('');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));expect(within(screen.getByRole('table')).getByText('Real task')).toBeTruthy();expect(screen.queryByRole('region',{name:'Planning Insights'})).toBeNull();expect(planner.read).toHaveBeenCalledWith('org',expect.stringMatching(/-01$/),'');});
it('quick add sends only essential production fields through canonical commands',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'New Task'}));const dialog=screen.getByRole('dialog',{name:'New creative task'});fireEvent.change(within(dialog).getByLabelText(/Title/),{target:{value:'New work'}});fireEvent.click(within(dialog).getByRole('button',{name:'Add task'}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({org:'org',brand:'brand',action:'create',payload:expect.objectContaining({title:'New work',content_type:'post',due_date:expect.any(String),assignee_id:'',priority:'normal',brief:''})})));expect(planner.command.mock.calls.at(-1)[0].payload).not.toHaveProperty('status');});
it('does not offer review approval without reviewer authority',async()=>{auth.hasPermission.mockImplementation(code=>!code.endsWith('.approve'));planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('button',{name:'Approve',exact:true})).toBeNull();});
it('drag cannot bypass creative approval',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');const region=screen.getByRole('region',{name:'Completed'});fireEvent.drop(region,{dataTransfer:{getData:()=>task.id}});expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.payload.status==='completed')).toBe(false);});
it('keeps calendar planning on its own Insights surface',async()=>{render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');expect(screen.getByRole('region',{name:'Monthly Production calendar'})).toBeTruthy();expect(screen.queryByRole('tab',{name:'Board',exact:true})).toBeNull();expect(screen.queryByRole('button',{name:'New Task'})).toBeNull();});
it('saves readable brief and references inline while retaining the creative workspace',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('textbox',{name:'Description',exact:true})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Edit description'}));fireEvent.change(screen.getByRole('textbox',{name:'Description',exact:true}),{target:{value:'Updated brief'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:expect.objectContaining({brief:'Updated brief'})})));await vi.waitFor(()=>expect(screen.getByRole('button',{name:'Add Link',exact:true}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Add Link',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Reference link'}),{target:{value:'https://example.com/one'}});fireEvent.click(screen.getByRole('button',{name:'Add Link'}));await screen.findByRole('link',{name:'https://example.com/one'});expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();});
it('production checklist completion only saves evidence, never grants review approval',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{target:{value:'Review the composition'}});fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));const checkbox=await screen.findByRole('checkbox',{name:'Complete Review the composition'});await vi.waitFor(()=>expect(checkbox.disabled).toBe(false));fireEvent.click(checkbox);await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:expect.objectContaining({checklist:[{text:'Review the composition',done:true}]})})));expect(planner.command.mock.calls.some(([c])=>c.action==='approve')).toBe(false);});

it('production calendar preserves reviewed-task movement restrictions',async()=>{planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');expect(within(screen.getByRole('region',{name:'Monthly Production calendar'})).queryByRole('button',{name:/Move Real task/})).toBeNull();});
it('optimistically moves a permitted task without board reload and restores failed persistence',async()=>{
 let reject;planner.command.mockImplementation(c=>c.action==='transition'?new Promise((_,no)=>{reject=no}):Promise.resolve({}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 fireEvent.keyDown(within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 expect(within(screen.getByRole('region',{name:'In Progress'})).getByText('Real task')).toBeTruthy();
 await vi.waitFor(()=>expect(reject).toBeTruthy());reject(new Error('Task changed. Reload before moving.'));
 await screen.findByRole('alert');await vi.waitFor(()=>expect(within(screen.getByRole('region',{name:'Planned'})).getByText('Real task')).toBeTruthy());
 expect(planner.command.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({action:'transition',revision:1,payload:{month:expect.any(String),status:'in_progress'}}));
});
it('keyboard dragging cannot approve an In Review task',async()=>{planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.keyDown(within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});expect(planner.command.mock.calls.some(([c])=>c.action==='transition'||c.action==='approve')).toBe(false);expect(screen.getByRole('dialog',{name:'Request Revision'})).toBeTruthy();expect(screen.getByRole('button',{name:'Request Revision',exact:true}).disabled).toBe(false);});

it('thumbnail opens the shared preview without opening the task drawer',async()=>{planner.read.mockResolvedValue({...read,tasks:[{...task,asset_ids:['asset'],assets:[{id:'asset',state:'ready',filename:'preview.jpg',mime_type:'image/jpeg'}]}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:'Preview preview.jpg',exact:true}));expect(screen.getByRole('dialog',{name:'preview.jpg'})).toBeTruthy();expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Close preview'}));fireEvent.click(screen.getByRole('button',{name:'View Real task'}));expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();});

it('weekly production reschedules only the canonical due date and retains planning/publishing evidence',async()=>{
 render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');
 const schedule=screen.getByRole('region',{name:'Monthly Production calendar'});
 fireEvent.keyDown(within(schedule).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',revision:1,payload:{month:'2026-10-01',due_date:'2026-10-13'}})));
 await vi.waitFor(()=>expect(within(schedule.querySelector('[data-kanban-column="2026-10-13"]')).getByText('Real task')).toBeTruthy());
 expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.action==='transition')).toBe(false);
});
it('weekly rescheduling rolls back failed persistence',async()=>{
 let reject;planner.command.mockImplementation(c=>c.action==='save'?new Promise((_,no)=>{reject=no}):Promise.resolve({}));
 render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');
 const schedule=screen.getByRole('region',{name:'Monthly Production calendar'});
 fireEvent.keyDown(within(schedule).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 expect(within(schedule.querySelector('[data-kanban-column="2026-10-13"]')).getByText('Real task')).toBeTruthy();
 await vi.waitFor(()=>expect(reject).toBeTruthy());reject(new Error('Task changed. Reload before continuing.'));
 await screen.findByRole('alert');await vi.waitFor(()=>expect(within(schedule.querySelector('[data-kanban-column="2026-10-12"]')).getByText('Real task')).toBeTruthy());
});
it('monthly production preserves reviewed task authority and navigates the planning month',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');
 expect(within(screen.getByRole('region',{name:'Monthly Production calendar'})).queryByRole('button',{name:/Move Real task/})).toBeNull();
 expect(screen.queryByRole('button',{name:'Change production date for Real task'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Next month'}));await vi.waitFor(()=>expect(planner.read).toHaveBeenCalledWith('org','2026-11-01',''));
});
it('brand targets preserve unavailable publication evidence without planned progress',async()=>{planner.read.mockResolvedValue({...read,targets:[{brand_id:'brand',brand_name:'Brand',posts:8,reels:0,planned_posts:2,planned_reels:1,completed_posts:1,completed_reels:0,published_available:false}]});render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Brand Targets'}));expect(screen.queryByRole('progressbar')).toBeNull();expect(screen.getByRole('button',{name:'Manage Targets'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Edit Targets'})).toBeNull();expect(screen.getByText('Publishing evidence has not been synchronized')).toBeTruthy();});
it('reveals compact item/link editors and Escape cancels without dismissing the drawer',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 expect(screen.queryByRole('textbox',{name:'Checklist item',exact:true})).toBeNull();expect(screen.queryByRole('textbox',{name:'Reference link'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{target:{value:'Cancelled'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{key:'Escape'});
 expect(screen.queryByRole('textbox',{name:'Checklist item',exact:true})).toBeNull();expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Add Link',exact:true}));fireEvent.keyDown(screen.getByRole('textbox',{name:'Reference link'}),{key:'Escape'});expect(screen.queryByRole('textbox',{name:'Reference link'})).toBeNull();expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
});
it('Enter adds a checklist item and failed persistence retains retry text without duplicating it',async()=>{
 planner.command.mockImplementation(c=>c.action==='save'?Promise.reject(new Error('Task changed. Reload.')):Promise.resolve({}));render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{target:{value:'Composition'}});fireEvent.keyDown(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{key:'Enter'});
 await screen.findByRole('alert');await vi.waitFor(()=>expect(screen.getByRole('textbox',{name:'Checklist item',exact:true}).value).toBe('Composition'));
 fireEvent.keyDown(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{key:'Enter'});await vi.waitFor(()=>expect(planner.command.mock.calls.filter(([c])=>c.action==='save').length).toBe(2));expect(planner.command.mock.calls.at(-1)[0].payload.checklist).toEqual([{text:'Composition',done:false}]);
});
it('description failure preserves editable text and Escape restores it without closing the task',async()=>{
 planner.command.mockImplementation(c=>c.action==='save'?Promise.reject(new Error('Save failed')):Promise.resolve({}));render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Edit description'}));fireEvent.change(screen.getByRole('textbox',{name:'Description',exact:true}),{target:{value:'Keep this draft'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'Description',exact:true}).value).toBe('Keep this draft');fireEvent.keyDown(screen.getByRole('textbox',{name:'Description',exact:true}),{key:'Escape'});expect(screen.getByRole('button',{name:'Edit description'}).textContent).toContain(task.brief);expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
});

it('centered and populated Planned actions open the existing New Task flow',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[]});render(<ContentPlannerPage/>);await vi.waitFor(()=>expect(planner.read).toHaveBeenCalled());await vi.waitFor(()=>expect(screen.getByRole('button',{name:'New Task',exact:true}).disabled).toBe(false));await screen.findByRole('button',{name:'Add Task',exact:true});fireEvent.click(screen.getByRole('button',{name:'Add Task',exact:true}));expect(screen.getByRole('dialog',{name:'New creative task'})).toBeTruthy();
});
it('empty media quick action opens shared media workflow independently of task detail',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'Add media to Real task'}));expect(screen.getByRole('dialog',{name:'Creative media · Real task'})).toBeTruthy();expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();
});
it('review drop requires feedback and invokes the canonical reviewer command',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.keyDown(within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 fireEvent.change(screen.getByRole('textbox',{name:'Review feedback (optional)'}),{target:{value:'Revise caption'}});fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'request_revision',revision:1,payload:{month:expect.any(String),feedback:'Revise caption'}})));
});
it('completed reopen is explicit and uses existing creative save authority',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'completed',history:[{action:'approve',revision:1,date:new Date().toISOString()}]}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 const handle=within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:/Move Real task/});
 // Pointer drops may cross more than one column; keyboard adjacent moves remain lifecycle constrained.
 fireEvent.keyDown(handle,{key:'ArrowLeft'});expect(planner.command.mock.calls.some(([c])=>c.action==='save')).toBe(false);
});

it('Board hides old approvals only, while List and monthly metrics retain them',async()=>{
 const old={...task,status:'completed',history:[{action:'approve',revision:1,date:'2020-01-01T00:00:00Z'}]};planner.read.mockResolvedValue({...read,tasks:[old]});render(<ContentPlannerPage/>);await screen.findByText('1 older or undated hidden',{exact:false});expect(within(screen.getByRole('region',{name:'Completed'})).queryByText('Real task')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'View All Completed'}));expect(within(screen.getByRole('table')).getByText('Real task')).toBeTruthy();
});
it('monthly publish changes only unlinked planned dates and preserves committed records',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,planned_publish_date:'2026-10-12'}]});render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));
 const calendar=screen.getByRole('region',{name:'Monthly Publish calendar'});fireEvent.keyDown(within(calendar).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:{month:'2026-10-01',planned_publish_date:'2026-10-13'}})));
 expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.action==='transition')).toBe(false);
});

it('keeps Monthly Publish selected across month reloads',async()=>{
 render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));fireEvent.click(screen.getByRole('button',{name:'Next month'}));
 await vi.waitFor(()=>expect(planner.read).toHaveBeenCalledWith('org','2026-11-01',''));await screen.findByRole('region',{name:'Monthly Publish calendar'});expect(screen.getByRole('tab',{name:'Monthly Publish'}).getAttribute('aria-selected')).toBe('true');
});

it('List reads compact values, previews actual media and exposes optional columns',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,asset_ids:['asset'],assets:[{id:'asset',state:'ready',filename:'creative.jpg',mime_type:'image/jpeg'}],checklist:[{text:'Shoot',done:true},{text:'Edit',done:false}]}]});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 const table=screen.getByRole('table');expect(within(table).getAllByRole('columnheader').map(n=>n.textContent)).toEqual(['Task','Brand','Status','Priority','Production Due','Assignee','Actions']);
 expect(within(table).queryByRole('combobox')).toBeNull();expect(within(table).queryByRole('textbox')).toBeNull();expect(within(table).getByLabelText('1 of 2 checklist steps complete')).toBeTruthy();
 fireEvent.click(within(table).getByRole('button',{name:'Preview creative.jpg'}));expect(screen.getByRole('dialog',{name:'creative.jpg'})).toBeTruthy();expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Close preview'}));fireEvent.click(screen.getByRole('button',{name:'Columns'}));fireEvent.click(screen.getByRole('checkbox',{name:'Checklist'}));expect(within(table).getByRole('columnheader',{name:'Checklist'})).toBeTruthy();expect(JSON.parse(localStorage.getItem('marketing.planner.planner-user')).listColumns).toEqual(['checklist']);
});
it('List saves priority optimistically and confines a failure to that field',async()=>{
 let reject;planner.read.mockResolvedValue({...read,tasks:[task,{...task,id:'second',title:'Another task'}]});planner.command.mockImplementation(c=>c.action==='save'?new Promise((_,no)=>{reject=no}):Promise.resolve({}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Priority for Real task'}));fireEvent.change(await screen.findByRole('combobox',{name:'Priority options for Real task'}),{target:{value:'high'}});
 const row=screen.getByRole('row',{name:'Open Real task'});expect(within(row).getByText('High')).toBeTruthy();expect(screen.getByRole('button',{name:'Priority for Real task'}).disabled).toBe(true);expect(screen.getByRole('button',{name:'Priority for Another task'}).disabled).toBe(false);
 await vi.waitFor(()=>expect(reject).toBeTruthy());reject(new Error('Task changed. Reload before continuing.'));await screen.findByRole('alert');await vi.waitFor(()=>expect(within(row).getByText('Normal')).toBeTruthy());
 expect(within(row).getByRole('alert').textContent).toContain('Task changed');expect(planner.command.mock.calls.filter(([c])=>c.action==='open_month')).toHaveLength(1);expect(planner.command.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({action:'save',revision:1,payload:{month:expect.any(String),priority:'high'}}));
});
it('List uses canonical date and brand-eligible assignee edits without a drawer',async()=>{
 const members=[{id:'eligible',name:'Brand editor',brand_ids:['brand']},{id:'other',name:'Other brand editor',brand_ids:['other']}];let current={...read,members};planner.read.mockResolvedValue(current);planner.command.mockImplementation(async c=>{if(c.action==='save'){current={...current,tasks:current.tasks.map(t=>t.id===c.id?{...t,...c.payload,revision:t.revision+1}:t)};planner.read.mockResolvedValue(current)}return {}});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Production Due Date for Real task'}));const date=await screen.findByRole('textbox',{name:/Production Due Date/});fireEvent.change(date,{target:{value:'16 Oct 2026'}});expect(planner.command.mock.calls.some(([c])=>c.action==='save')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Save date'}));
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',revision:1,payload:{month:expect.any(String),due_date:'2026-10-16'}})));
 await vi.waitFor(()=>expect(screen.getByRole('button',{name:'Assignee for Real task'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Assignee for Real task'}));const select=await screen.findByRole('combobox',{name:'Assignee options for Real task'});expect(within(select).getByRole('option',{name:'Brand editor'})).toBeTruthy();expect(within(select).queryByRole('option',{name:'Other brand editor'})).toBeNull();fireEvent.change(select,{target:{value:'eligible'}});
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',revision:2,payload:{month:expect.any(String),assignee_id:'eligible'}})));expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();
});
it('List reviewer transitions preserve optional feedback without changing sort or order',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Status for Real task'}));fireEvent.change(await screen.findByRole('combobox',{name:'Status options for Real task'}),{target:{value:'revision_needed'}});
 const dialog=await screen.findByRole('dialog',{name:'Request Revision'});expect(within(dialog).getByRole('button',{name:'Request Revision'}).disabled).toBe(false);expect(planner.command.mock.calls.some(([c])=>c.action==='request_revision')).toBe(false);
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Review feedback (optional)'}),{target:{value:'Please revise the composition'}});fireEvent.click(within(dialog).getByRole('button',{name:'Request Revision'}));
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'request_revision',revision:1,payload:{month:expect.any(String),feedback:'Please revise the composition'}})));expect(planner.order).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem('marketing.planner.planner-user')).sort).not.toBe('manual');
});
it('List never offers approval without reviewer authority',async()=>{
 auth.hasPermission.mockImplementation(code=>!code.endsWith('.approve'));planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 expect(screen.queryByRole('button',{name:'Status for Real task'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Actions for Real task'}));expect(screen.queryByRole('menuitem',{name:'Approve production…'})).toBeNull();expect(planner.command.mock.calls.some(([c])=>c.action==='approve')).toBe(false);
});
it('grouping is presentation-only, disables order and keeps Planning Insights selection across views',async()=>{
 localStorage.setItem('marketing.planner.planner-user',JSON.stringify({sort:'manual',view:'list'}));planner.read.mockResolvedValue({...read,tasks:[task,{...task,id:'second',title:'Second task',status:'in_progress'}]});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');expect(screen.getByRole('button',{name:/Reorder Real task/})).toBeTruthy();fireEvent.change(screen.getByRole('combobox',{name:'Group By'}),{target:{value:'status'}});expect(screen.queryByRole('button',{name:/Reorder Real task/})).toBeNull();expect(screen.getAllByText('1 task on this page')).toHaveLength(2);expect(planner.order).not.toHaveBeenCalled();
 for(const view of ['Board','List']){fireEvent.click(screen.getByRole('tab',{name:view,exact:true}));expect(screen.queryByRole('region',{name:'Planning Insights'})).toBeNull()}
 expect(screen.getByRole('button',{name:'Planning month'}).textContent).toContain('October 2026');expect(planner.command.mock.calls.filter(([c])=>c.action==='open_month')).toHaveLength(1);
});
it('keyboard ordering uses the complete unfiltered sequence across pagination',async()=>{
 localStorage.setItem('marketing.planner.planner-user',JSON.stringify({sort:'manual',view:'list'}));const tasks=Array.from({length:41},(_,i)=>({...task,id:'t'+i,title:'Task '+i,manual_order:i+1}));planner.read.mockResolvedValue({...read,tasks});planner.order.mockResolvedValue({ordered:41});
 render(<ContentPlannerPage/>);await screen.findAllByText('Task 0');fireEvent.click(screen.getAllByRole('button',{name:'Next',exact:true})[0]);
 fireEvent.keyDown(screen.getByRole('button',{name:/Reorder Task 20\./}),{key:'ArrowDown'});await vi.waitFor(()=>expect(planner.order).toHaveBeenCalled());const sent=planner.order.mock.calls[0][3];expect(sent).toHaveLength(41);expect(sent.slice(0,20).map(t=>t.id)).toEqual(tasks.slice(0,20).map(t=>t.id));expect(sent.slice(20,22).map(t=>t.id)).toEqual(['t21','t20']);expect(screen.getByRole('button',{name:'2',exact:true})).toBeTruthy();
});

it('Drawer requests revision without feedback and uses reviewer authority',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));
 expect(screen.getByRole('textbox',{name:'Review feedback (optional)'}).value).toBe('');fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'request_revision',revision:1,payload:expect.objectContaining({feedback:''})})));
});
it('Board drag requests revision without mandatory feedback',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.keyDown(within(screen.getByRole('region',{name:'Creative workflow'})).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});fireEvent.click(await screen.findByRole('button',{name:'Request Revision',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'request_revision',payload:expect.objectContaining({feedback:''})})));
});
it('Drawer blocker action uses only independent blocker authority and keeps reason optional',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('checkbox',{name:'Blocked'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Mark Blocked',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'block',revision:1,payload:{month:expect.any(String),blocked:true}})));expect(planner.command.mock.calls.some(([c])=>c.action==='transition')).toBe(false);
});
it('Drawer contextual menu confirms soft removal and keeps secondary lifecycle actions out of the header',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_progress'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('button',{name:'Return to Planned'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Task actions'}));expect(await screen.findByRole('menuitem',{name:'Return to Planned'})).toBeTruthy();fireEvent.click(screen.getByRole('menuitem',{name:'Remove Task'}));const confirmation=await screen.findByRole('dialog',{name:'Remove Task?'});expect(planner.command.mock.calls.some(([c])=>c.action==='delete')).toBe(false);fireEvent.click(within(confirmation).getByRole('button',{name:'Remove Task'}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'delete',revision:1})));
});
it('Planner canonical month grid synchronizes the planning period without clearing Insights selection',async()=>{
 render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));fireEvent.click(screen.getByRole('button',{name:'Planning month'}));fireEvent.click(screen.getByRole('gridcell',{name:'Nov'}));await vi.waitFor(()=>expect(planner.read).toHaveBeenCalledWith('org','2026-11-01',''));expect(screen.getByRole('tab',{name:'Monthly Publish'}).getAttribute('aria-selected')).toBe('true');expect(document.querySelector('input[type=month]')).toBeNull();
});

it('brand-only navigation preserves Board default and saved view preference',async()=>{
 window.history.replaceState({},'','/marketing/planner?marketing_brand=brand');render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 expect(screen.getByRole('tab',{name:'Board',exact:true}).getAttribute('aria-selected')).toBe('true');
 fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));cleanup();render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 expect(screen.getByRole('tab',{name:'List',exact:true}).getAttribute('aria-selected')).toBe('true');
});

it('creates optional properties once and uses the same saved task in Board, List and Detail',async()=>{
 const members=[{id:'member',name:'Eligible Staff',brand_ids:['brand']}];planner.read.mockResolvedValue({...read,members});
 planner.command.mockImplementation(async c=>{if(c.action==='create')planner.read.mockResolvedValue({...read,members,tasks:[{...task,id:'new',...c.payload,title:'Assigned creative',assignee_name:'Eligible Staff'}]});return {}});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'New Task'}));const dialog=within(screen.getByRole('dialog',{name:'New creative task'}));
 fireEvent.change(dialog.getByLabelText(/Title/),{target:{value:'Assigned creative'}});fireEvent.change(dialog.getByRole('combobox',{name:'Assignee'}),{target:{value:'member'}});fireEvent.change(dialog.getByRole('combobox',{name:'Priority'}),{target:{value:'high'}});fireEvent.change(dialog.getByRole('textbox',{name:'Description'}),{target:{value:'First line\nSecond line'}});fireEvent.click(dialog.getByRole('button',{name:'Add task'}));
 await screen.findAllByText('Assigned creative');expect(planner.command.mock.calls.filter(([c])=>c.action==='create')).toHaveLength(1);expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'create',payload:expect.objectContaining({assignee_id:'member',priority:'high',brief:'First line\nSecond line'})}));
 expect(screen.getAllByLabelText('Eligible Staff').length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));expect(within(screen.getByRole('table')).getByText('Eligible Staff')).toBeTruthy();expect(within(screen.getByRole('table')).getByText('High')).toBeTruthy();
 fireEvent.click(within(screen.getByRole('table')).getByText('Assigned creative'));const detail=within(screen.getByRole('dialog',{name:'Creative task'}));expect(detail.getByRole('combobox',{name:'Assignee'}).value).toBe('member');expect(detail.getByRole('combobox',{name:'Priority'}).value).toBe('high');expect(detail.getByRole('button',{name:'Edit description'}).textContent).toContain('First line');
});
it('limits initial assignees by Brand and clears selection when Brand changes',async()=>{
 marketing.context.mockResolvedValue({organizations:[{id:'org'}],brands:[{id:'brand',organization_id:'org',name:'Brand'},{id:'other',organization_id:'org',name:'Other'}]});planner.read.mockResolvedValue({...read,members:[{id:'one',name:'Brand Staff',brand_ids:['brand']},{id:'two',name:'Other Staff',brand_ids:['other']}]});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'New Task'}));const dialog=within(screen.getByRole('dialog',{name:'New creative task'}));
 expect(dialog.queryByRole('option',{name:'Other Staff'})).toBeNull();fireEvent.change(dialog.getByRole('combobox',{name:'Assignee'}),{target:{value:'one'}});fireEvent.change(dialog.getByRole('combobox',{name:'Brand'}),{target:{value:'other'}});expect(dialog.getByRole('combobox',{name:'Assignee'}).value).toBe('');expect(dialog.queryByRole('option',{name:'Brand Staff'})).toBeNull();expect(dialog.getByRole('option',{name:'Other Staff'})).toBeTruthy();
});
it('retains optional create fields after an actionable server rejection',async()=>{
 planner.command.mockImplementation(async c=>{if(c.action==='create')throw new Error('Choose an authorized brand team member.');return {}});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'New Task'}));const dialog=within(screen.getByRole('dialog',{name:'New creative task'}));fireEvent.change(dialog.getByLabelText(/Title/),{target:{value:'Keep draft'}});fireEvent.change(dialog.getByRole('textbox',{name:'Description'}),{target:{value:'Keep description'}});fireEvent.click(dialog.getByRole('button',{name:'Add task'}));await dialog.findByRole('alert');expect(dialog.getByRole('textbox',{name:'Description'}).value).toBe('Keep description');expect(dialog.getByLabelText(/Title/).value).toBe('Keep draft');
});

it('keeps unsaved attachment selection after failure without changing canonical media',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));planner.command.mockRejectedValueOnce(new Error('Task changed. Reopen and retry.'));let result;await act(async()=>{result=await media.props.onChange(['snapshot'])});expect(result).toBe(false);expect(media.props.values).toEqual(['snapshot']);expect(read.tasks[0].asset_ids).toEqual([]);expect(screen.getByRole('alert').textContent).toContain('Task changed');expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
});
it('retains an accepted media revision when refresh fails and uses it for the next save',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'Add media to Real task'}));
 planner.command.mockResolvedValueOnce({...task,revision:2,asset_ids:['snapshot']});planner.read.mockRejectedValueOnce(new Error('Refresh unavailable'));
 let result;await act(async()=>{result=await media.props.onChange(['snapshot'])});expect(result.revision).toBe(2);expect(media.props.values).toEqual(['snapshot']);expect(screen.getByText('Saved. Activity could not refresh; your saved revision is retained.')).toBeTruthy();
 planner.command.mockResolvedValueOnce({...task,revision:3,asset_ids:[]});planner.read.mockResolvedValueOnce({...read,tasks:[{...task,revision:3,asset_ids:[]}]});
 await act(async()=>{await media.props.onChange([])});expect(planner.command.mock.calls.at(-1)[0]).toMatchObject({revision:2,payload:{month:'2026-10-01',asset_ids:[]}});expect(media.props.values).toEqual([]);
});
it('reconciles stale media saves without overwriting unrelated changes or regressing to an older read',async()=>{
 const original={...task,asset_ids:['a']};planner.read.mockResolvedValue({...read,tasks:[original]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 const latest={...original,revision:2,priority:'high'};planner.read.mockResolvedValue({...read,tasks:[latest]});
 planner.command.mockRejectedValueOnce(Object.assign(new Error('Task changed'),{cause:{code:'PT409'}})).mockResolvedValueOnce({...latest,revision:3,asset_ids:[]});
 await act(async()=>{await media.props.onChange([])});expect(media.props.values).toEqual([]);
 expect(planner.command.mock.calls.at(-1)[0]).toMatchObject({revision:2,payload:{month:'2026-10-01',asset_ids:[]}});expect(Object.keys(planner.command.mock.calls.at(-1)[0].payload)).toEqual(['month','asset_ids']);
 planner.command.mockResolvedValueOnce({...latest,revision:4,asset_ids:['a']});await act(async()=>{await media.props.onChange(['a'])});expect(planner.command.mock.calls.at(-1)[0].revision).toBe(3);
});
it('loads conflicting latest media explicitly while keeping unsaved removal for review and saving',async()=>{
 const original={...task,asset_ids:['a']};planner.read.mockResolvedValue({...read,tasks:[original]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 const latest={...original,revision:2,asset_ids:['b'],assets:[{id:'b',filename:'Concurrent.jpg'}]};planner.read.mockResolvedValue({...read,tasks:[latest]});planner.command.mockRejectedValueOnce(Object.assign(new Error('Task changed'),{cause:{code:'PT409'}}));
 await act(async()=>{expect(await media.props.onChange([])).toBe(false)});expect(media.props.values).toEqual([]);expect(screen.getByText(/Latest attached media: Concurrent.jpg/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Load latest task · keep my edits'}));expect(media.props.values).toEqual([]);
 planner.command.mockResolvedValueOnce({...latest,revision:3,asset_ids:[]});fireEvent.click(screen.getByRole('button',{name:'Save changes',exact:true}));await vi.waitFor(()=>expect(planner.command.mock.calls.at(-1)[0]).toMatchObject({revision:2,payload:{month:'2026-10-01',asset_ids:[]}}));
});

it.each(['planned','in_progress'])('Drawer can complete %s production with reviewer authority without a review hop',async status=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Complete production',exact:true}));
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'approve',revision:1,payload:{month:'2026-10-01'}})));
 expect(planner.command.mock.calls.some(([c])=>c.action==='handoff'||c.action==='transition')).toBe(false);
});
it('Drawer can request revision directly from Planned and cannot offer completion to edit-only staff',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'planned'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'request_revision',payload:{month:'2026-10-01',feedback:''}})));
 cleanup();auth.hasPermission.mockImplementation(code=>!code.endsWith('.approve'));render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 expect(screen.queryByRole('button',{name:'Complete production',exact:true})).toBeNull();expect(screen.queryByRole('button',{name:'Request Revision',exact:true})).toBeNull();
});

it('keeps search and all production filters in the shared bar, retaining List grouping through Board switches',async()=>{
 localStorage.setItem('marketing.planner.planner-user',JSON.stringify({month:'2026-10-01',brand:'brand',search:'Real',assignee:'unassigned',status:'planned',sort:'title',groupBy:'status',view:'list'}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 const bar=screen.getByRole('region',{name:'Planner filters'});
 expect(bar.hasAttribute('data-admin-filter-toolbar')).toBe(true);
 expect(within(bar).getByRole('searchbox',{name:'Search'}).value).toBe('Real');
 for(const label of ['Assignee','Status','Handling','Sort','Group By'])expect(within(bar).getByRole('combobox',{name:label})).toBeTruthy();
 expect(within(bar).getByRole('button',{name:'Columns'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Filters',exact:true})).toBeNull();
 fireEvent.click(within(bar).getByRole('tab',{name:'Board',exact:true}));
 expect(screen.queryByRole('combobox',{name:'Group By'})).toBeNull();expect(screen.queryByRole('button',{name:'Columns'})).toBeNull();
 expect(within(bar).getByRole('combobox',{name:'Status'}).value).toBe('planned');
 expect(within(bar).getByRole('searchbox',{name:'Search'}).value).toBe('Real');
 fireEvent.click(within(bar).getByRole('tab',{name:'List',exact:true}));
 expect(within(bar).getByRole('combobox',{name:'Group By'}).value).toBe('status');
 fireEvent.click(within(bar).getByRole('button',{name:'Remove Status filter'}));
 expect(within(bar).getByRole('combobox',{name:'Status'}).value).toBe('');
 fireEvent.click(within(bar).getByRole('button',{name:'Clear all'}));
 expect(within(bar).getByRole('searchbox',{name:'Search'}).value).toBe('');
 expect(within(bar).getByRole('combobox',{name:'Assignee'}).value).toBe('');
 expect(within(bar).getByRole('combobox',{name:'Sort'}).value).toBe('title');
 expect(within(bar).getByRole('combobox',{name:'Group By'}).value).toBe('status');
 expect(screen.getByRole('combobox',{name:'Brand'}).value).toBe('brand');
 expect(screen.getByRole('button',{name:'Planning month'}).textContent).toContain('October 2026');
 expect(planner.order).not.toHaveBeenCalled();expect(planner.command.mock.calls.every(([command])=>command.action==='open_month')).toBe(true);
});
it('keeps the same visible shared filters and saved values across Planning Insights calendar tabs',async()=>{
 localStorage.setItem('marketing.planner.planner-user',JSON.stringify({month:'2026-10-01',search:'Real',sort:'due',groupBy:'brand'}));
 const first=render(<ContentPlannerPage surface="insights"/>);await screen.findAllByText('Real task');
 const bar=screen.getByRole('region',{name:'Planning Insights filters'});
 expect(within(bar).getByRole('searchbox',{name:'Search'}).value).toBe('Real');
 for(const label of ['Assignee','Status','Handling','Sort'])expect(within(bar).getByRole('combobox',{name:label})).toBeTruthy();
 expect(screen.queryByRole('combobox',{name:'Group By'})).toBeNull();expect(screen.queryByRole('button',{name:'Filters',exact:true})).toBeNull();
 fireEvent.change(within(bar).getByRole('combobox',{name:'Status'}),{target:{value:'planned'}});
 fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));
 expect(within(bar).getByRole('combobox',{name:'Status'}).value).toBe('planned');
 expect(within(bar).getByRole('combobox',{name:'Sort'}).value).toBe('due');
 first.unmount();render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 expect(screen.getByRole('searchbox',{name:'Search'}).value).toBe('Real');
 expect(screen.getByRole('combobox',{name:'Status'}).value).toBe('planned');
 fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));
 expect(screen.getByRole('combobox',{name:'Group By'}).value).toBe('brand');
});

it.each(['planned','in_progress','in_review'].flatMap(status=>['approve','request_revision'].map(action=>({status,action}))))('confirms $action from $status before closing, without waiting for refresh',async({status,action})=>{
 const original={...task,status};planner.read.mockResolvedValue({...read,tasks:[original]});
 let complete,refresh;planner.command.mockImplementation(c=>c.action===action?new Promise(resolve=>{complete=resolve}):Promise.resolve({}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));
 if(action==='request_revision'){fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Review feedback (optional)'}),{target:{value:'Keep this feedback'}});}
 planner.read.mockImplementation(()=>new Promise(resolve=>{refresh=resolve}));
 const submit=screen.getByRole('button',{name:action==='request_revision'?'Request Revision':status==='in_review'?'Approve':'Complete production',exact:true});
 fireEvent.click(submit);fireEvent.click(submit);
 expect(submit.disabled).toBe(true);expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0);expect(planner.command.mock.calls.filter(([c])=>c.action===action)).toHaveLength(1);
 expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
 const result={...original,status:action==='approve'?'completed':'revision_needed',revision:2,updated_at:new Date().toISOString(),approved_revision:action==='approve'?2:null};
 await act(async()=>{complete(result)});
 expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();expect(refresh).toBeTypeOf('function');
 expect(within(screen.getByRole('region',{name:action==='approve'?'Completed':'Revision Needed'})).getByText('Real task')).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));expect(within(screen.getByRole('table')).getByText(action==='approve'?'Completed':'Revision Needed')).toBeTruthy();
 expect(planner.command.mock.calls.filter(([c])=>c.action==='open_month')).toHaveLength(1);expect(marketing.plannerPublishing).not.toHaveBeenCalled();
 await act(async()=>{refresh({...read,tasks:[original]})});
 expect(within(screen.getByRole('table')).getByText(action==='approve'?'Completed':'Revision Needed')).toBeTruthy();
});

it('keeps review feedback and exact request identity after an uncertain failure',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));
 fireEvent.change(screen.getByRole('textbox',{name:'Review feedback (optional)'}),{target:{value:'Keep composition feedback'}});
 planner.command.mockRejectedValueOnce(new Error('Connection lost. Check and retry.'));
 fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await screen.findByRole('alert');
 expect(screen.getByRole('textbox',{name:'Review feedback (optional)'}).value).toBe('Keep composition feedback');expect(screen.getByRole('button',{name:'Request Revision',exact:true}).disabled).toBe(false);
 const first=planner.command.mock.calls.at(-1)[0];planner.command.mockResolvedValueOnce({...task,status:'revision_needed',revision:2});
 fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await vi.waitFor(()=>expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull());
 expect(planner.command.mock.calls.at(-1)[0]).toEqual(first);expect(planner.read).toHaveBeenCalledTimes(2);
});

it('keeps confirmed Board review success if background ordering fails',async()=>{
 const original={...task,status:'in_review'};planner.read.mockResolvedValue({...read,tasks:[original]});let finish;
 planner.command.mockImplementation(c=>c.action==='request_revision'?new Promise(resolve=>{finish=resolve}):Promise.resolve({}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.keyDown(screen.getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 const modal=await screen.findByRole('dialog',{name:'Request Revision'});fireEvent.change(within(modal).getByRole('textbox'),{target:{value:'Board feedback'}});fireEvent.click(within(modal).getByRole('button',{name:'Request Revision',exact:true}));
 expect(within(screen.getByRole('region',{name:'In Review'})).getByText('Real task')).toBeTruthy();
 const accepted={...original,status:'revision_needed',revision:2};let refresh;
 planner.read.mockImplementation(()=>new Promise(resolve=>{refresh=resolve}));planner.order.mockRejectedValueOnce(new Error('Order changed'));
 await act(async()=>{finish(accepted)});expect(screen.queryByRole('dialog',{name:'Request Revision'})).toBeNull();expect(within(screen.getByRole('region',{name:'Revision Needed'})).getByText('Real task')).toBeTruthy();
 await act(async()=>{refresh({...read,tasks:[accepted]})});await screen.findByText(/Task saved. Activity or position could not refresh/);
 expect(within(screen.getByRole('region',{name:'Revision Needed'})).getByText('Real task')).toBeTruthy();expect(planner.command.mock.calls.filter(([c])=>c.action==='request_revision')).toHaveLength(1);
});

it('does not report review success or close feedback on a canonical revision conflict',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));
 planner.command.mockRejectedValueOnce(Object.assign(new Error('Task changed. Reload before continuing.'),{cause:{code:'PT409'}}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await screen.findByRole('alert');expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();expect(planner.read).toHaveBeenCalledTimes(1);expect(screen.queryByText('Revision requested.')).toBeNull();
});

it.each(['completed','revision_needed'])('List confirmation applies %s once while its refresh is pending',async status=>{
 localStorage.setItem('marketing.planner.planner-user',JSON.stringify({month:'2026-10-01',view:'list'}));render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 fireEvent.click(screen.getByRole('button',{name:'Status for Real task'}));fireEvent.change(screen.getByRole('combobox',{name:'Status options for Real task'}),{target:{value:status}});
 const modal=await screen.findByRole('dialog',{name:status==='completed'?'Approve production':'Request Revision'});let complete,refresh;
 planner.command.mockImplementation(()=>new Promise(resolve=>{complete=resolve}));planner.read.mockImplementation(()=>new Promise(resolve=>{refresh=resolve}));
 const button=within(modal).getByRole('button',{name:status==='completed'?'Approve':'Request Revision',exact:true});fireEvent.click(button);fireEvent.click(button);expect(button.disabled).toBe(true);
 expect(within(screen.getByRole('table')).getByText('Planned')).toBeTruthy();await act(async()=>{complete({...task,status,revision:2,updated_at:new Date().toISOString()})});
 expect(screen.queryByRole('dialog')).toBeNull();expect(within(screen.getByRole('table')).getByText(status==='completed'?'Completed':'Revision Needed')).toBeTruthy();expect(refresh).toBeTypeOf('function');
 expect(planner.command.mock.calls.filter(([c])=>c.action!=='open_month')).toHaveLength(1);
});

it('shows current revision instructions on Board cards and full feedback/history in Task Detail',async()=>{
 const feedback='Current instructions — revise the opening shot.\n保留品牌标志，让字幕更易读。\nCheck the final frame before review.\nFull final instruction remains available in detail.';
 const revised={...task,status:'revision_needed',revision:6,review_feedback:'Do not use the stale projection',assignee_name:'Kai Lin',asset_ids:['asset'],assets:[{id:'asset',state:'ready',filename:'reference.jpg',mime_type:'image/jpeg'}],history:[{revision:6,action:'ordered',date:'2026-10-22T00:00:00Z'},{revision:5,action:'request_revision',date:'2026-10-22T00:00:00Z',feedback},{revision:3,action:'transition',date:'2026-10-21T00:00:00Z'},{revision:2,action:'request_revision',date:'2026-10-20T00:00:00Z',feedback:'Old resolved instructions'}]};
 planner.read.mockResolvedValue({...read,tasks:[revised]});auth.hasPermission.mockImplementation(code=>!code.endsWith('.approve'));render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 const column=within(screen.getByRole('region',{name:'Revision Needed'})),panel=column.getByRole('complementary',{name:'Revision request feedback'});
 expect(panel.classList.contains('is-compact')).toBe(true);expect(panel.textContent).toBe(feedback);expect(column.queryByText('Old resolved instructions')).toBeNull();expect(column.queryByText('Do not use the stale projection')).toBeNull();
 expect(column.getByRole('button',{name:'Preview reference.jpg'})).toBeTruthy();expect(column.getByText('Post')).toBeTruthy();expect(column.getByLabelText('Kai Lin')).toBeTruthy();expect(column.getByRole('button',{name:/Move Real task/})).toBeTruthy();
 fireEvent.click(column.getByRole('button',{name:'View Real task'}));const detail=within(screen.getByRole('dialog',{name:'Creative task'}));expect(detail.getByRole('complementary',{name:'Revision request feedback'}).classList.contains('is-compact')).toBe(false);expect(detail.getByRole('complementary',{name:'Revision request feedback'}).textContent).toBe(feedback);expect(detail.getByText('Old resolved instructions')).toBeTruthy();expect(detail.queryByRole('button',{name:'Request Revision',exact:true})).toBeNull();
});
it('keeps a newer blank request neutral and hides revision feedback on other columns',async()=>{
 const history=[{revision:2,action:'request_revision',feedback:'Old resolved instructions'},{revision:3,action:'transition'},{revision:4,action:'request_revision',feedback:''}];
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'revision_needed',revision:4,review_feedback:'Stale fallback must not leak',history},{...task,id:'active',title:'In production',status:'in_progress',revision:5,history}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 expect(within(screen.getByRole('region',{name:'Revision Needed'})).getByText('No revision instructions provided')).toBeTruthy();expect(within(screen.getByRole('region',{name:'In Progress'})).queryByRole('complementary',{name:'Revision request feedback'})).toBeNull();expect(screen.queryByText('Old resolved instructions')).toBeNull();
});
it('projects the just-confirmed revision event before its background history refresh',async()=>{
 const previous={...task,revision:3,history:[{revision:2,action:'request_revision',feedback:'Old resolved instructions'},{revision:3,action:'transition'}]};planner.read.mockResolvedValue({...read,tasks:[previous]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task'}));fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Review feedback (optional)'}),{target:{value:'New confirmed instructions'}});
 planner.read.mockImplementation(()=>new Promise(()=>{}));planner.command.mockResolvedValueOnce({...previous,history:undefined,status:'revision_needed',revision:4,review_feedback:'New confirmed instructions',updated_at:'2026-10-22T00:00:00Z'});
 fireEvent.click(screen.getByRole('button',{name:'Request Revision',exact:true}));await screen.findByText('Revision requested.');expect(within(screen.getByRole('region',{name:'Revision Needed'})).getByRole('complementary',{name:'Revision request feedback'}).textContent).toBe('New confirmed instructions');
});

it('feedback Popover stays separate from Task Detail and Board dragging',async()=>{
 const height=vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(180),visible=vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(60);
 try{
  planner.read.mockResolvedValue({...read,tasks:[{...task,status:'revision_needed',revision:2,history:[{revision:2,action:'request_revision',feedback:'Long current instructions'}]}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
  planner.command.mockClear();const panel=screen.getByRole('button',{name:'Read full revision instructions'});fireEvent.pointerDown(panel,{button:0,clientX:10,clientY:10});fireEvent.click(panel);expect(screen.getByRole('tooltip').textContent).toBe('Long current instructions');expect(screen.queryByRole('dialog',{name:'Creative task'})).toBeNull();expect(document.body.classList.contains('admin-kanban-dragging')).toBe(false);expect(planner.command).not.toHaveBeenCalled();
  fireEvent.keyDown(panel,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();expect(screen.getByRole('button',{name:/Move Real task/})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'View Real task'}));expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();
 }finally{height.mockRestore();visible.mockRestore()}
});
