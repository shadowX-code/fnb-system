import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import ContentPlannerPage from '../ContentPlannerPage.jsx';
const {planner,marketing,auth}=vi.hoisted(()=>({planner:{command:vi.fn(),read:vi.fn(),order:vi.fn()},marketing:{context:vi.fn(),assetUrl:vi.fn(),plannerPublishing:vi.fn()},auth:{user:{id:'planner-user'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../plannerService.js',()=>({plannerService:planner}));vi.mock('../marketingService.js',()=>({marketingService:marketing}));vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,ariaLabel,value,onChange,options,disabled})=><label>{label}<select aria-label={ariaLabel||label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
vi.mock('../MarketingMediaPicker.jsx',()=>({default:()=>null}));
const task={id:'task',organization_id:'org',brand_id:'brand',brand_name:'Brand',title:'Real task',content_type:'post',due_date:'2026-10-12',planned_week:'2026-10-12',planned_publish_date:null,priority:'normal',brief:'Approved factual brief',reference_links:[],asset_ids:[],assets:[],history:[],status:'planned',blocked:false,blocker_reason:'',revision:1,manual_order:1,created_at:'2026-10-12'};
const read={tasks:[task],members:[],targets:[],templates:[],drafts:[]};
beforeEach(()=>{cleanup();localStorage.clear();window.history.replaceState({},'','/marketing/planner');vi.clearAllMocks();marketing.plannerPublishing.mockResolvedValue({rows:[],total_count:0});marketing.assetUrl.mockResolvedValue('https://example.com/preview.jpg');auth.hasPermission.mockImplementation(()=>true);marketing.context.mockResolvedValue({organizations:[{id:'org',name:'Org'}],brands:[{id:'brand',organization_id:'org',name:'Brand'}]});planner.read.mockResolvedValue(read);let current=read;planner.command.mockImplementation(async c=>{if(c.action==='save'){current={...current,tasks:current.tasks.map(t=>t.id===c.id?{...t,...c.payload,revision:t.revision+1}:t)};planner.read.mockResolvedValue(current);}return {}});});
it('defaults to All Brands and shares real task records across views',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');expect(screen.getByRole('combobox',{name:'Brand'}).value).toBe('');fireEvent.click(screen.getByRole('tab',{name:'List',exact:true}));expect(within(screen.getByRole('table')).getByText('Real task')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'Monthly Plan'}));expect(screen.getAllByText('Real task').length).toBeGreaterThan(0);expect(planner.read).toHaveBeenCalledWith('org',expect.stringMatching(/-01$/),'');});
it('quick add sends only essential production fields through canonical commands',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'New Task'}));const dialog=screen.getByRole('dialog',{name:'New creative task'});fireEvent.change(within(dialog).getByLabelText(/Title/),{target:{value:'New work'}});fireEvent.click(within(dialog).getByRole('button',{name:'Add task'}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({org:'org',brand:'brand',action:'create',payload:expect.objectContaining({title:'New work',content_type:'post',due_date:expect.any(String)})})));expect(planner.command.mock.calls.at(-1)[0].payload).not.toHaveProperty('status');});
it('does not offer review approval without reviewer authority',async()=>{auth.hasPermission.mockImplementation(code=>!code.endsWith('.approve'));planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('button',{name:'Approve',exact:true})).toBeNull();});
it('drag cannot bypass creative approval',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');const region=screen.getByRole('region',{name:'Completed'});fireEvent.drop(region,{dataTransfer:{getData:()=>task.id}});expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.payload.status==='completed')).toBe(false);});
it('weekly plan movement sends only planned_week rather than silently changing due dates',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Plan'}));fireEvent.keyDown(within(screen.getByRole('region',{name:'Monthly planning weeks'})).getByRole('button',{name:/Move Real task/}),{key:'ArrowLeft'});await vi.waitFor(()=>expect(planner.command.mock.calls.some(([c])=>c.action==='save'&&c.payload.planned_week)).toBe(true));const payload=planner.command.mock.calls.at(-1)[0].payload;expect(payload).not.toHaveProperty('due_date');expect(payload).not.toHaveProperty('planned_publish_date');});

it('saves readable brief and references inline while retaining the creative workspace',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));expect(screen.queryByRole('textbox',{name:'Description',exact:true})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Edit description'}));fireEvent.change(screen.getByRole('textbox',{name:'Description',exact:true}),{target:{value:'Updated brief'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:expect.objectContaining({brief:'Updated brief'})})));await vi.waitFor(()=>expect(screen.getByRole('button',{name:'Add Link',exact:true}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Add Link',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Reference link'}),{target:{value:'https://example.com/one'}});fireEvent.click(screen.getByRole('button',{name:'Add Link'}));await screen.findByRole('link',{name:'https://example.com/one'});expect(screen.getByRole('dialog',{name:'Creative task'})).toBeTruthy();});
it('production checklist completion only saves evidence, never grants review approval',async()=>{render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('button',{name:'View Real task',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Checklist item',exact:true}),{target:{value:'Review the composition'}});fireEvent.click(screen.getByRole('button',{name:'Add Item',exact:true}));const checkbox=await screen.findByRole('checkbox',{name:'Complete Review the composition'});await vi.waitFor(()=>expect(checkbox.disabled).toBe(false));fireEvent.click(checkbox);await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:expect.objectContaining({checklist:[{text:'Review the composition',done:true}]})})));expect(planner.command.mock.calls.some(([c])=>c.action==='approve')).toBe(false);});

it('monthly planning cards remain draggable when workflow movement is review-restricted',async()=>{planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');expect(screen.getByRole('region',{name:'In Review'}).querySelector('article').draggable).toBe(false);fireEvent.click(screen.getByRole('tab',{name:'Monthly Plan'}));expect(within(screen.getByRole('region',{name:'Monthly planning weeks'})).getByRole('button',{name:/Move Real task/})).toBeTruthy();});

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
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 const schedule=screen.getByRole('region',{name:'Monthly Production calendar'});
 fireEvent.keyDown(within(schedule).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',revision:1,payload:{month:'2026-10-01',due_date:'2026-10-13'}})));
 await vi.waitFor(()=>expect(within(schedule.querySelector('[data-kanban-column="2026-10-13"]')).getByText('Real task')).toBeTruthy());
 expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.action==='transition')).toBe(false);
});
it('weekly rescheduling rolls back failed persistence',async()=>{
 let reject;planner.command.mockImplementation(c=>c.action==='save'?new Promise((_,no)=>{reject=no}):Promise.resolve({}));
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 const schedule=screen.getByRole('region',{name:'Monthly Production calendar'});
 fireEvent.keyDown(within(schedule).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});
 expect(within(schedule.querySelector('[data-kanban-column="2026-10-13"]')).getByText('Real task')).toBeTruthy();
 await vi.waitFor(()=>expect(reject).toBeTruthy());reject(new Error('Task changed. Reload before continuing.'));
 await screen.findByRole('alert');await vi.waitFor(()=>expect(within(schedule.querySelector('[data-kanban-column="2026-10-12"]')).getByText('Real task')).toBeTruthy());
});
it('monthly production preserves reviewed task authority and navigates the planning month',async()=>{
 planner.read.mockResolvedValue({...read,tasks:[{...task,status:'in_review'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');
 expect(within(screen.getByRole('region',{name:'Monthly Production calendar'})).queryByRole('button',{name:/Move Real task/})).toBeNull();
 expect(screen.queryByRole('button',{name:'Change production date for Real task'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Next insights month'}));await vi.waitFor(()=>expect(planner.read).toHaveBeenCalledWith('org','2026-11-01',''));
});
it('brand targets distinguish unset targets, planned progress and unavailable publishing',async()=>{
 planner.read.mockResolvedValue({...read,targets:[{brand_id:'brand',brand_name:'Brand',posts:8,reels:0,planned_posts:2,planned_reels:1,completed_posts:1,completed_reels:0,published_available:false}]});
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Brand Targets'}));
 expect(screen.getByRole('progressbar',{name:'Brand posts planned target'}).value).toBe(2);expect(screen.getByText('6 remaining')).toBeTruthy();expect(screen.getByText('Target unset')).toBeTruthy();expect(screen.getByRole('button',{name:'Edit Targets'})).toBeTruthy();expect(screen.getByLabelText('Brand posts publishing evidence unavailable')).toBeTruthy();
});

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
 planner.read.mockResolvedValue({...read,tasks:[{...task,planned_publish_date:'2026-10-12'}]});render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));
 const calendar=screen.getByRole('region',{name:'Monthly Publish calendar'});fireEvent.keyDown(within(calendar).getByRole('button',{name:/Move Real task/}),{key:'ArrowRight'});await vi.waitFor(()=>expect(planner.command).toHaveBeenCalledWith(expect.objectContaining({action:'save',payload:{month:'2026-10-01',planned_publish_date:'2026-10-13'}})));
 expect(planner.command.mock.calls.some(([c])=>c.action==='approve'||c.action==='transition')).toBe(false);
});

it('keeps Monthly Publish selected across month reloads',async()=>{
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));fireEvent.click(screen.getByRole('button',{name:'Next insights month'}));
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
 fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));for(const view of ['Board','Monthly Plan','List']){fireEvent.click(screen.getByRole('tab',{name:view,exact:true}));expect(screen.getByRole('tab',{name:'Monthly Publish'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('region',{name:'Planning Insights'})).toBeTruthy()}
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
 render(<ContentPlannerPage/>);await screen.findAllByText('Real task');fireEvent.click(screen.getByRole('tab',{name:'Monthly Publish'}));fireEvent.click(screen.getByRole('button',{name:'Planning month'}));fireEvent.click(screen.getByRole('gridcell',{name:'Nov'}));await vi.waitFor(()=>expect(planner.read).toHaveBeenCalledWith('org','2026-11-01',''));expect(screen.getByRole('tab',{name:'Monthly Publish'}).getAttribute('aria-selected')).toBe('true');expect(document.querySelector('input[type=month]')).toBeNull();
});
