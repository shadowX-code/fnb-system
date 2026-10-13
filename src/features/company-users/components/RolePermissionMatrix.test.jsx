import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import RolePermissionMatrix from './RolePermissionMatrix.jsx';
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options})=><label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
afterEach(()=>{cleanup();window.history.replaceState({},'','/')});
it('shows real workspace access, truthful action counts, aliases and only relevant Marketing actions',()=>{
 window.history.replaceState({},'','/?permission_workspace=marketing');render(<RolePermissionMatrix permissions={new Set(['marketing_workspace.access','marketing_content.view'])} readOnly/>);
 const workspace=screen.getByRole('region',{name:'Marketing permissions'});
 expect(within(workspace).getByText('Marketing Workspace')).toBeTruthy();
 const row=within(workspace).getByText('Marketing Workspace').closest('tr');expect(within(row).getByText('1 active actions')).toBeTruthy();expect(within(row).getByText('Enabled')).toBeTruthy();
 expect(screen.queryByRole('columnheader',{name:'Prepare Payroll Runs'})).toBeNull();expect(screen.queryByRole('columnheader',{name:'Configure Payroll'})).toBeNull();
 const content=within(workspace).getByText('Content permissions').closest('tr');expect(within(content).getByText('1 active actions')).toBeTruthy();expect(within(content).getByText(/Used by .*Media Library/)).toBeTruthy();
 fireEvent.change(screen.getByRole('combobox',{name:'Module'}),{target:{value:'marketing_workspace'}});
 expect(screen.getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Module','Access']);
});
it('preserves selected grants while switching filters and submits only registered codes',()=>{
 const toggle=vi.fn();const permissions=new Set(['marketing_content.view']);render(<RolePermissionMatrix permissions={permissions} onToggle={toggle}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'Workspace'}),{target:{value:'marketing'}});fireEvent.change(screen.getByRole('combobox',{name:'Module'}),{target:{value:'marketing_workspace'}});
 fireEvent.click(screen.getByRole('button',{name:'Marketing Workspace: Access Marketing Workspace'}));
 expect(toggle.mock.calls[0][2].codes).toEqual(['marketing_workspace.access']);
 fireEvent.change(screen.getByRole('combobox',{name:'Workspace'}),{target:{value:'factory'}});fireEvent.change(screen.getByRole('combobox',{name:'Workspace'}),{target:{value:'marketing'}});
 expect(permissions).toEqual(new Set(['marketing_content.view']));expect(screen.getByRole('combobox',{name:'Module'}).value).toBe('');
});
it('locks unauthorized actions and read-only views cannot toggle',()=>{
 const toggle=vi.fn();window.history.replaceState({},'','/?permission_workspace=marketing');render(<RolePermissionMatrix permissions={new Set()} onToggle={toggle} cellLocked={()=>true}/>);
 const button=screen.getByRole('button',{name:'Marketing Workspace: Access Marketing Workspace'});expect(button.disabled).toBe(true);fireEvent.click(button);expect(toggle).not.toHaveBeenCalled();
});

it('finds consumer pages through their existing owning permissions',()=>{
 render(<RolePermissionMatrix permissions={new Set()} readOnly/>);fireEvent.change(screen.getByRole('combobox',{name:'Workspace'}),{target:{value:'marketing'}});fireEvent.change(screen.getByPlaceholderText('Search modules or actions…'),{target:{value:'Media Library'}});
 const results=within(screen.getByRole('region',{name:'Marketing permissions'}));expect(results.getByText('Content permissions')).toBeTruthy();expect(results.queryByText('Marketing Workspace')).toBeNull();
});
