import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within,waitFor} from '@testing-library/react';
import MarketingSettingsPage,{legacySettingsDestination} from '../MarketingSettingsPage.jsx';
import BrandKnowledgeWorkspace from '../BrandKnowledgeWorkspace.jsx';
import BrandAccessConsole from '../BrandAccessConsole.jsx';
const {service,roles,auth}=vi.hoisted(()=>({service:{context:vi.fn(),read:vi.fn(),knowledge:vi.fn(),setup:vi.fn(),teamAccess:vi.fn(),roleScope:vi.fn(),teamBrandAccess:vi.fn(),memberBrandAccess:vi.fn()},roles:{listRoleOptions:vi.fn()},auth:{user:{id:'user'},profile:{id:'actor',role_name:'owner'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../marketingService.js',()=>({marketingService:service}));vi.mock('../../../services/roleService.js',()=>({roleService:roles}));vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../SocialAccounts.jsx',()=>({default:()=> <h2>Meta Social Accounts</h2>}));vi.mock('../GoogleDriveSettings.jsx',()=>({default:()=> <h2>Google Drive</h2>}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
const brand={id:'brand',organization_id:'org',name:'Idamans',timezone:'Asia/Kuala_Lumpur',outlets:[]};
const profile={identity:{text:'Approved brand identity',provenance:'verified_brand_fact'},voice:{text:'Proposed voice',provenance:'ai_suggestion'},references:{text:'Market reference',provenance:'external_research',source_url:'https://example.com/source'}};
const data={knowledge:[{brand_id:'brand',revision:3,profile}],role_scopes:[{role_id:'staff',all_brands:false,brand_ids:['brand']}],events:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();window.history.replaceState({},'','/');sessionStorage.clear();auth.hasPermission.mockImplementation(()=>true);service.context.mockResolvedValue({organizations:[{id:'org'}],brands:[brand]});service.read.mockResolvedValue(data);service.setup.mockResolvedValue({members:[{id:'actor',name:'Isaac',role_id:'owner'},{id:'member',name:'Staff',role_id:'staff'}],roles:[{id:'staff',name:'Marketing Staff'}],employees:[{id:'new',name:'New staff'}]});roles.listRoleOptions.mockResolvedValue([{id:'owner',name:'owner'},{id:'staff',name:'Marketing Staff'}]);service.teamBrandAccess.mockResolvedValue({members:[{id:"actor",name:"Isaac",role_id:"owner",role_name:"owner",brand_ids:["brand"],all_brands:true,revision:1,editable:false},{id:"member",name:"Staff",role_id:"staff",role_name:"Marketing Staff",brand_ids:["brand"],revision:1,editable:true,permission_codes:["marketing_content.view"]}],employees:[{id:"new",name:"New staff"}]});service.memberBrandAccess.mockResolvedValue({});service.knowledge.mockResolvedValue({});service.roleScope.mockResolvedValue({});});
afterEach(cleanup);
it('Connections has both integration sections, Brand context and no internal tabs',async()=>{render(<MarketingSettingsPage/>);await screen.findByRole('heading',{name:'Meta Social Accounts'});expect(screen.getByRole('heading',{name:'Google Drive'})).toBeTruthy();expect(screen.queryByRole('tab')).toBeNull();expect(screen.queryByRole('combobox',{name:'Organization'})).toBeNull();expect(service.read).not.toHaveBeenCalled()});
it('legacy URLs preserve callback state and lead to canonical Connections',async()=>{window.history.replaceState({},'','/marketing/settings?drive_result=connected&marketing_brand=brand');render(<MarketingSettingsPage section="legacy"/>);await screen.findByRole('heading',{name:'Connections',exact:true});expect(window.location.pathname).toBe('/marketing/connections');expect(new URLSearchParams(window.location.search).get('drive_result')).toBe('connected');expect(legacySettingsDestination('?tab=knowledge')).toBe('/marketing/brand-knowledge');expect(legacySettingsDestination('?tab=access')).toBe('/marketing/brand-access')});
it('contextual knowledge edits preserve other sections, evidence and revision',async()=>{const saved=vi.fn();render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>true} onSaved={saved}/>);expect(screen.queryByRole('combobox')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Edit Brand Identity'}));fireEvent.change(screen.getByRole('textbox',{name:'Brand identity'}),{target:{value:'Revised identity'}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(service.knowledge).toHaveBeenCalledWith('brand',3,{...profile,identity:{text:'Revised identity',provenance:'verified_brand_fact'}}));expect(saved).toHaveBeenCalledOnce()});
it('cannot silently promote an AI suggestion to verified knowledge',()=>{render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>true} onSaved={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Edit Brand Voice'}));fireEvent.change(screen.getByRole('combobox',{name:'Brand voice evidence'}),{target:{value:'verified_brand_fact'}});expect(screen.getByRole('button',{name:'Save Changes'}).disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:'I confirm this information is verified for this Brand.'}));expect(screen.getByRole('button',{name:'Save Changes'}).disabled).toBe(false);expect(service.knowledge).not.toHaveBeenCalled()});
it('knowledge stale-save errors leave the editor and draft intact',async()=>{service.knowledge.mockRejectedValue(new Error('Brand knowledge changed. Reload before saving.'));render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>true} onSaved={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Edit Brand Voice'}));fireEvent.change(screen.getByRole('textbox',{name:'Brand voice'}),{target:{value:'Changed suggestion'}});fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'Brand voice'}).value).toBe('Changed suggestion')});
it('Access shows real members/roles/scopes and only links to canonical Brand management',async()=>{render(<BrandAccessConsole org="org" brandId="" brands={[brand]} data={data} auth={auth} onSaved={()=>{}}/>);await screen.findByText('Staff');expect(screen.getByRole('link',{name:'Manage Brands & Outlets'}).getAttribute('href')).toBe('/system/brands');expect(screen.queryByRole('button',{name:'Add Brand'})).toBeNull();expect(screen.queryByRole('combobox',{name:'Organization'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'View access for Staff'}));expect(await screen.findByRole('dialog',{name:'Brand Access · Staff'})).toBeTruthy();expect(within(screen.getByRole('dialog')).getByText('Marketing Staff')).toBeTruthy();expect(service.teamAccess).not.toHaveBeenCalled();expect(service.roleScope).not.toHaveBeenCalled()});
it('saves only the selected member using a revision-bound Platform command',async()=>{render(<BrandAccessConsole org="org" brands={[brand]} auth={auth} onSaved={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'View access for Staff'}));fireEvent.click(screen.getByRole('checkbox',{name:'Idamans'}));fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(service.memberBrandAccess).toHaveBeenCalledWith('org','member',[],1,expect.any(String)));expect(service.roleScope).not.toHaveBeenCalled();});
it('does not expose membership or role mutation controls without permission',async()=>{service.teamBrandAccess.mockResolvedValue({members:[{id:'member',name:'Staff',role_name:'Marketing Staff',brand_ids:['brand'],editable:false}],employees:[]});const readAuth={...auth,hasPermission:()=>false};render(<BrandAccessConsole org="org" brands={[brand]} data={data} auth={readAuth} onSaved={()=>{}}/>);await screen.findByText('Staff');expect(screen.queryByRole('button',{name:'Add Member'})).toBeNull();expect(screen.queryByRole('button',{name:'Edit Brand Scope'})).toBeNull();expect(roles.listRoleOptions).not.toHaveBeenCalled()});

it('coverage counts filled sections without calling suggestions verified',()=>{
 render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>false} onSaved={()=>{}}/>);
 expect(screen.getByText('3 of 5 sections filled')).toBeTruthy();
 expect(screen.getByText('Completion is separate from verification.')).toBeTruthy();
 expect(screen.getByText('AI suggestion · unverified')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Edit Brand Identity'})).toBeNull();
});
it('protects dirty drafts on Cancel and refresh, and discards only after confirmation',()=>{
 render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>true} onSaved={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Brand Identity'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Brand identity'}),{target:{value:'Unsaved identity'}});
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));
 expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Continue Editing'}));
 expect(screen.getByRole('textbox',{name:'Brand identity'}).value).toBe('Unsaved identity');
 fireEvent.keyDown(screen.getByRole('textbox',{name:'Brand identity'}),{key:'Escape'});
 fireEvent.click(screen.getByRole('button',{name:'Discard Changes'}));
 expect(screen.queryByRole('textbox')).toBeNull();expect(service.knowledge).not.toHaveBeenCalled();
 const cleanUnload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(cleanUnload);expect(cleanUnload.defaultPrevented).toBe(false);
});
it('keeps multiline edits across fields and preserves their evidence',async()=>{
 render(<BrandKnowledgeWorkspace brand={brand} data={data} can={()=>true} onSaved={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit Brand Identity'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Brand identity'}),{target:{value:'Identity\nSecond line'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Knowledge Field'}),{target:{value:'products'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Products'}),{target:{value:'Confirmed QA product'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await waitFor(()=>expect(service.knowledge).toHaveBeenCalledWith('brand',3,{...profile,identity:{...profile.identity,text:'Identity\nSecond line'},products:{text:'Confirmed QA product',provenance:'verified_brand_fact'}}));
});
it('renders only explicit secure reference links and rejects unsafe evidence URLs',async()=>{
 const referenceData={...data,knowledge:[{brand_id:'brand',revision:3,profile:{references:{text:'Guide\nhttps://drive.google.com/file/d/asset/view\njavascript:alert(1)',provenance:'external_research',source_url:'https://user:secret@example.com'}}}]};
 render(<BrandKnowledgeWorkspace brand={brand} data={referenceData} can={()=>true} onSaved={()=>{}}/>);
 expect(screen.getByRole('link',{name:/drive.google.com/}).getAttribute('href')).toBe('https://drive.google.com/file/d/asset/view');
 expect(screen.queryByRole('link',{name:'Open source'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Edit Guidelines & References'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Supporting references'}),{target:{value:'Updated reference'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await screen.findByText('External references need an HTTPS source URL.');expect(service.knowledge).not.toHaveBeenCalled();
});
it('Brand Access navigates to canonical Marketing role permissions without a duplicate role editor',async()=>{
 render(<BrandAccessConsole org="org" brands={[brand]} data={data} auth={auth} onSaved={()=>{}}/>);await screen.findByText('Staff');
 expect(screen.getByRole('link',{name:'Roles & Permissions'}).getAttribute('href')).toBe('/people/roles?permission_workspace=marketing');
 expect(screen.queryByRole('button',{name:'Edit Role Scope'})).toBeNull();expect(service.roleScope).not.toHaveBeenCalled();
});
it('uses the existing role-view alias for canonical navigation without granting scope editing',async()=>{
 const aliased={...auth,hasPermission:code=>code==='roles_permissions.view'};render(<BrandAccessConsole org="org" brands={[brand]} data={data} auth={aliased} onSaved={()=>{}}/>);await screen.findByText('Staff');
 expect(screen.getByRole('link',{name:'Roles & Permissions'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Edit Brand Scope'})).toBeNull();expect(service.roleScope).not.toHaveBeenCalled();
});

it('guards unsaved member selections and never permits editing self scope',async()=>{render(<BrandAccessConsole org="org" brands={[brand]} auth={auth}/>);fireEvent.click(await screen.findByRole('button',{name:'View access for Staff'}));fireEvent.click(screen.getByRole('checkbox',{name:'Idamans'}));fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Continue Editing'}));expect(screen.getByRole('checkbox',{name:'Idamans'}).checked).toBe(false);expect(service.memberBrandAccess).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Discard Changes'}));fireEvent.click(screen.getByRole('button',{name:'View access for Isaac'}));expect(screen.getByRole('checkbox',{name:'Idamans'}).matches(':disabled')).toBe(true);expect(screen.queryByRole('button',{name:'Save Changes'})).toBeNull();});
it('defaults Team to All Brands independent of Connections context preference',async()=>{sessionStorage.setItem('marketing.settings.brand.user','brand');render(<MarketingSettingsPage section="access"/>);await screen.findByRole('heading',{name:'Team & Brand Access'});await screen.findByText('Staff');expect(screen.getByRole('combobox',{name:'Brand'}).value).toBe('');expect(service.read).not.toHaveBeenCalled();});
