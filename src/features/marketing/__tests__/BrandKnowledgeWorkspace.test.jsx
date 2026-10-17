import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import Workspace,{promotionState} from '../BrandKnowledgeWorkspace.jsx';
const {service}=vi.hoisted(()=>({service:{knowledgeCommand:vi.fn(),knowledgeAI:vi.fn(),menuSource:vi.fn()}}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const brand={id:'brand',name:'Test Brand'},data={knowledge:[{brand_id:'brand',revision:3,profile:{identity:{text:'Legacy story',provenance:'verified_brand_fact'},products:{text:'Retained product',provenance:'pending_verification'}}}],canonical_outlets:[],customer_knowledge:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();service.knowledgeCommand.mockResolvedValue({})});
it('shows five practical areas, optional FAQs and no separate approval gates',()=>{render(<Workspace brand={brand} data={data} can={()=>true}/>);expect(screen.getAllByRole('tab')).toHaveLength(5);expect(screen.getByRole('tab',{name:'Products & Menu'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Review for AI'})).toBeNull();expect(screen.getAllByText('Legacy story').length).toBeGreaterThan(0);expect(screen.getByText('Retained product')).toBeTruthy()});
it('uses guided fields and one revision-bound manager save',async()=>{const saved=vi.fn();render(<Workspace brand={brand} data={data} can={()=>true} onSaved={saved}/>);fireEvent.click(screen.getByRole('button',{name:'Edit Brand Identity'}));fireEvent.change(screen.getByRole('textbox',{name:'Brand story'}),{target:{value:'New story'}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(service.knowledgeCommand).toHaveBeenCalledWith(expect.any(String),'brand','identity',undefined,3,expect.objectContaining({story:'New story'})));expect(saved).toHaveBeenCalledOnce()});
it('keeps a failed save and dirty draft available',async()=>{service.knowledgeCommand.mockRejectedValue(new Error('Knowledge changed. Reload.'));render(<Workspace brand={brand} data={data} can={()=>true}/>);fireEvent.click(screen.getByRole('button',{name:'Edit Brand Identity'}));fireEvent.change(screen.getByRole('textbox',{name:'Brand story'}),{target:{value:'Unsaved story'}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'Brand story'}).value).toBe('Unsaved story');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeTruthy()});
it('shows read-only mapped Outlets, missing facts and canonical source link',()=>{render(<Workspace brand={brand} data={{...data,canonical_outlets:[{id:'o',name:'Outlet',address:'Real address',is_active:true}]}} can={()=>false}/>);fireEvent.click(screen.getByRole('tab',{name:'Outlet Information'}));expect(screen.getByText('Real address')).toBeTruthy();expect(screen.getAllByText('Not available at source')).toHaveLength(2);expect(screen.getByRole('link',{name:'Manage at Source'}).getAttribute('href')).toBe('/operations/outlets');expect(screen.queryByRole('button',{name:'Edit Outlet Information'})).toBeNull()});
it('separates current, future, expired and inactive promotion states inclusively',()=>{const p={state:'confirmed',data:{starts_on:'2026-10-18',ends_on:'2026-10-18'}};expect(promotionState(p,'2026-10-18')).toBe('Current');expect(promotionState(p,'2026-10-17')).toBe('Upcoming');expect(promotionState(p,'2026-10-19')).toBe('Expired');expect(promotionState({...p,state:'inactive'},'2026-10-18')).toBe('Inactive')});
it('requires a source-bearing menu confirmation and preserves unavailable versus zero',()=>{const entry={id:'m',kind:'menu',state:'preview',revision:1,filename:'menu.pdf',data:{currency:'MYR',items:[{name:'Tea',price:null},{name:'Water',price:'0'}]}};render(<Workspace brand={brand} data={{...data,customer_knowledge:[entry]}} can={()=>true}/>);fireEvent.click(screen.getByRole('tab',{name:'Products & Menu'}));fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));expect(screen.getByRole('textbox',{name:'Price 1'}).value).toBe('');expect(screen.getByRole('textbox',{name:'Price 2'}).value).toBe('0');expect(screen.getByRole('button',{name:'Confirm Menu'})).toBeTruthy();expect(service.knowledgeCommand).not.toHaveBeenCalled()});
it('does not expose management actions to a read-only user',()=>{render(<Workspace brand={brand} data={data} can={()=>false}/>);expect(screen.queryByRole('button',{name:'Edit Brand Identity'})).toBeNull();fireEvent.click(screen.getByRole('tab',{name:'Promotions'}));expect(screen.queryByRole('button',{name:'Add Promotion'})).toBeNull()});

it('previews unsaved tone without writing Brand knowledge or sending',async()=>{service.knowledgeAI.mockResolvedValue({state:'completed',result:{text:'Hello! How can our team help?'}});render(<Workspace brand={brand} data={data} can={()=>true}/>);fireEvent.click(screen.getByRole('tab',{name:'Tone & Persona'}));fireEvent.click(screen.getByRole('button',{name:'Edit Tone & Persona'}));fireEvent.click(screen.getAllByRole('button',{name:'Preview reply tone'}).find(b=>!b.disabled));await screen.findByText('Hello! How can our team help?');expect(service.knowledgeAI).toHaveBeenCalledWith(expect.any(String),'brand','tone',null,expect.objectContaining({tone:'warm'}));expect(service.knowledgeCommand).not.toHaveBeenCalled()});

it('creates a new promotion at revision zero independently of Brand Knowledge revision',async()=>{render(<Workspace brand={brand} data={data} can={()=>true} onSaved={()=>{}}/>);fireEvent.click(screen.getByRole('tab',{name:'Promotions'}));fireEvent.click(screen.getByRole('button',{name:'Add Promotion'}));fireEvent.change(screen.getByRole('textbox',{name:'Promotion name *'}),{target:{value:'QA offer'}});fireEvent.change(screen.getByRole('textbox',{name:'Promotion details'}),{target:{value:'QA details'}});fireEvent.click(screen.getByRole('button',{name:'Save Promotion'}));await waitFor(()=>expect(service.knowledgeCommand).toHaveBeenCalledWith(expect.any(String),'brand','promotion',undefined,0,expect.objectContaining({name:'QA offer'})))});

it('reads guided audience rather than losing it behind an empty legacy projection',()=>{
 render(<Workspace brand={brand} data={{...data,knowledge:[{brand_id:'brand',profile:{identity:{fields:{audience:'Families at lunch',positioning:'Local comfort food'}}}}]}} can={()=>false}/>);
 expect(screen.getByText('Families at lunch')).toBeTruthy();
});
it('renders source-bound menu prices with genuine zero and unavailable kept distinct',()=>{
 const entry={id:'m',kind:'menu',state:'confirmed',revision:2,filename:'menu.pdf',data:{name:'Current Menu',currency:'MYR',items:[{name:'Tea',category:'Drinks',price:null},{name:'Water',category:'Drinks',price:'0'},{name:'Toast',category:'Food',price:'4.80'}]}};
 render(<Workspace brand={brand} data={{...data,customer_knowledge:[entry]}} can={()=>false}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Products & Menu'}));
 expect(screen.getByRole('cell',{name:'Unavailable'})).toBeTruthy();expect(screen.getByRole('cell',{name:'0.00'})).toBeTruthy();
 fireEvent.change(screen.getByRole('searchbox',{name:'Search menu items'}),{target:{value:'Toast'}});
 expect(screen.getByRole('cell',{name:'4.80'})).toBeTruthy();expect(screen.queryByRole('cell',{name:'Water'})).toBeNull();
 expect(service.knowledgeCommand).not.toHaveBeenCalled();
});
it('keeps inactive source evidence readable and excluded from AI without exposing confirmation',()=>{
 const entry={id:'m',kind:'menu',state:'inactive',filename:'old.pdf',data:{name:'Old Menu',items:[{name:'Tea',price:'1'}]}};
 render(<Workspace brand={brand} data={{...data,customer_knowledge:[entry]}} can={()=>true}/>);
 fireEvent.click(screen.getByRole('tab',{name:'Products & Menu'}));
 expect(screen.getByText('Excluded from AI')).toBeTruthy();expect(screen.getByRole('button',{name:'View source'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Confirm Menu'})).toBeNull();
});
it('opens a focused promotion drawer without creating records and preserves unsaved edits',()=>{
 render(<Workspace brand={brand} data={data} can={()=>true}/>);fireEvent.click(screen.getByRole('tab',{name:'Promotions'}));
 expect(screen.queryByRole('textbox',{name:'Promotion details'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Add Promotion'}));expect(screen.getByRole('dialog',{name:'Add Promotion'})).toBeTruthy();
 fireEvent.change(screen.getByRole('textbox',{name:'Promotion details'}),{target:{value:'Unsaved offer'}});
 fireEvent.click(screen.getByRole('button',{name:'Close drawer'}));expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeTruthy();
 expect(service.knowledgeCommand).not.toHaveBeenCalled();
});
it('separates saved tone from unsaved preview and clears preview on a changed setting',async()=>{
 service.knowledgeAI.mockResolvedValue({state:'completed',result:{text:'Welcome!'}});
 render(<Workspace brand={brand} data={data} can={()=>true}/>);fireEvent.click(screen.getByRole('tab',{name:'Tone & Persona'}));fireEvent.click(screen.getByRole('button',{name:'Edit Tone & Persona'}));
 fireEvent.click(screen.getByRole('button',{name:'Friendly'}));expect(screen.getByText('Unsaved settings')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Preview reply tone'}));await screen.findByText('Welcome!');
 fireEvent.click(screen.getByRole('button',{name:'Calm'}));expect(screen.queryByText('Welcome!')).toBeNull();expect(service.knowledgeCommand).not.toHaveBeenCalled();
});
it('does not call an approved but incomplete identity fully ready',()=>{
 render(<Workspace brand={brand} data={{...data,knowledge_approval_revision:3}} can={()=>false}/>);
 expect(screen.getByRole('button',{name:'Brand Identity: Partial'})).toBeTruthy();
});
