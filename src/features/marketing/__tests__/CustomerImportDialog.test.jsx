import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import CustomerImportDialog from '../CustomerImportDialog.jsx';
const {service}=vi.hoisted(()=>({service:{importPreview:vi.fn(),importCommit:vi.fn(),importJob:vi.fn(),queueImport:vi.fn(),importResults:vi.fn()}}));
vi.mock('../outreachService.js',()=>({outreachService:service}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options})=><label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
beforeEach(()=>{cleanup();vi.clearAllMocks();service.importJob.mockResolvedValue({jobs:[],mapping:null});service.queueImport.mockResolvedValue({id:'job',state:'completed'});service.importResults.mockResolvedValue({rows:[{row:1,status:'updated'}]})});
const row={row:1,classification:'review',snapshot:'current',values:{name:'New name',phone:'+60123456789'},differences:{name:{before:'Existing name',after:'New name'}}};
async function upload(){const file={name:'customers.csv',size:40,text:async()=> 'Name,Phone\nNew name,0123456789'};fireEvent.change(screen.getByLabelText('Customer import file'),{target:{files:[file]}});await screen.findByRole('button',{name:'Validate & preview'});await waitFor(()=>expect(screen.getByRole('button',{name:'Validate & preview'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Validate & preview'}));await screen.findByRole('button',{name:'Review 0 selected'})}
describe('customer import approval workflow',()=>{
 it('requires exact field selection and final confirmation before commit',async()=>{service.importPreview.mockResolvedValue({rows:[row]});service.importCommit.mockResolvedValue({rows:[{row:1,status:'updated'}]});render(<CustomerImportDialog org="org" brand="brand" brandName="Brand" onClose={()=>{}}/>);await upload();expect(service.importCommit).not.toHaveBeenCalled();const fields=screen.getAllByLabelText('Update name for row 1');expect(fields[0].checked).toBe(false);fireEvent.click(fields[0]);fireEvent.click(screen.getByRole('button',{name:'Review 1 selected'}));expect(screen.getByRole('button',{name:'Confirm import (1)'}).disabled).toBe(true);fireEvent.click(screen.getByLabelText(/I approve these selected customer changes/));fireEvent.click(screen.getByRole('button',{name:'Confirm import (1)'}));await screen.findByText('Import processed');expect(service.queueImport.mock.calls[0][4]['1']).toEqual({selected:true,snapshot:'current',fields:['name']});expect(service.queueImport).toHaveBeenCalledTimes(1)});
 it('reports an all-unchanged file without forcing a customer update',async()=>{service.importPreview.mockResolvedValue({rows:[{...row,classification:'unchanged',differences:{}}]});service.importCommit.mockResolvedValue({rows:[{row:1,status:'unchanged'}]});render(<CustomerImportDialog org="org" brand="brand" brandName="Brand" onClose={()=>{}}/>);await upload();fireEvent.click(screen.getByRole('button',{name:'Review 0 selected'}));fireEvent.click(screen.getByLabelText(/I approve these selected customer changes/));fireEvent.click(screen.getByRole('button',{name:'Confirm import (0)'}));await waitFor(()=>expect(service.queueImport).toHaveBeenCalledTimes(1));expect(service.queueImport.mock.calls[0][4]['1'].selected).toBe(false)});
});

it('shows background completion after a queued state without losing the final read',async()=>{
 service.importPreview.mockResolvedValue({rows:[{row:1,classification:'new',snapshot:'new',values:{name:'Synthetic',phone:'+60123456789'}}]});
 service.queueImport.mockResolvedValue({id:'job',state:'queued',total:1,processed:0,counts:{}});
 service.importJob.mockImplementation((org,brand,action)=>Promise.resolve(action==='read'?{id:'job',state:'completed',total:1,processed:1}: {jobs:[],mapping:null}));
 service.importResults.mockResolvedValue({id:'job',state:'completed',total:1,processed:1,rows:[{row:1,status:'created'}]});
 render(<CustomerImportDialog org="org" brand="brand" brandName="Brand" onClose={()=>{}}/>);
 const file={name:'customers.csv',size:40,text:async()=> 'Name,Phone\nSynthetic,0123456789'};
 fireEvent.change(screen.getByLabelText('Customer import file'),{target:{files:[file]}});
 await screen.findByRole('button',{name:'Validate & preview'});await waitFor(()=>expect(screen.getByRole('button',{name:'Validate & preview'}).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Validate & preview'}));
 fireEvent.click(await screen.findByRole('button',{name:'Review 1 selected'}));fireEvent.click(screen.getByLabelText(/I approve these selected customer changes/));fireEvent.click(screen.getByRole('button',{name:'Confirm import (1)'}));
 await screen.findByText('Importing in the background');await screen.findByText('Import processed',{}, {timeout:4000});expect(service.importResults).toHaveBeenCalled();
});
