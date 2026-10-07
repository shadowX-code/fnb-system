import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import WorkspacePage, { WorkspacePageActionsProvider, WorkspaceSurface } from '../WorkspacePage.jsx';
import AdminFilterToolbar from '../AdminFilterToolbar.jsx';
import SelectField from '../../forms/SelectField.jsx';
import AppShell from '../../../layouts/AppShell.jsx';
afterEach(()=>{cleanup();localStorage.clear();});
function Selection() {
  const [scope,setScope]=useState('all');
  const [selected,setSelected]=useState(false);
  return <WorkspacePage section="Finance" title="Analysis" controls={<AdminFilterToolbar><SelectField label="Scope" value={scope} onChange={setScope} options={[{value:'all',label:'All outlets'},{value:'one',label:'One outlet'}]}/></AdminFilterToolbar>}><WorkspaceSurface><button aria-pressed={selected} onClick={()=>setSelected(!selected)}>Selected driver</button><output>{scope}</output></WorkspaceSurface></WorkspacePage>;
}
it('colocates identity, controls and feature actions without resetting scope or selected canvas state',()=>{
  const content=<Selection/>;
  const view=render(<WorkspacePageActionsProvider actions={<button>Preview</button>}>{content}</WorkspacePageActionsProvider>);
  const header=screen.getByRole('banner',{name:'Analysis context'});
  expect(within(header).getByRole('heading',{name:'Analysis'})).toBeTruthy();
  fireEvent.click(within(header).getByRole('button',{name:'Scope'}));
  fireEvent.click(screen.getByRole('option',{name:'One outlet'}));
  fireEvent.click(screen.getByRole('button',{name:'Selected driver'}));
  view.rerender(<WorkspacePageActionsProvider actions={<button>Exit preview</button>} notice="Simulated evidence">{content}</WorkspacePageActionsProvider>);
  expect(screen.getByRole('button',{name:'Selected driver'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('one')).toBeTruthy();
  expect(within(header).getByRole('button',{name:'Exit preview'})).toBeTruthy();
  expect(within(header).getByText('Simulated evidence')).toBeTruthy();
});
it('keeps the standard shell default and existing navigation callbacks when analytical presentation is selected',()=>{
  const navigate=vi.fn();
  const props={activeRoute:{label:'Analysis'},activeRouteId:'finance_analysis',workspace:'finance',workspaceOptions:[{id:'finance',label:'Finance'}],sections:[{label:'Finance',items:[{id:'finance_analysis',label:'Analysis'},{id:'finance_cash',label:'Cash'}]}],store:{salesRecords:[],purchaseRecords:[],outlets:[],salesChannels:[],suppliers:[],outletTaxConfigs:[],specialMonths:[]},auth:{},onNavigate:navigate};
  const view=render(<AppShell {...props}><p>Legacy content</p></AppShell>);
  expect(screen.getByText('Smart Operations Workspace')).toBeTruthy();
  expect(document.querySelector('[data-admin-shell]').dataset.adminShell).toBe('standard');
  view.rerender(<AppShell {...props} presentation="analytical"><Selection/></AppShell>);
  expect(screen.queryByText('Smart Operations Workspace')).toBeNull();
  const nav=screen.getAllByRole('navigation',{name:'Workspace navigation'}).at(-1);
  expect(within(nav).getByRole('button',{name:'Analysis'}).getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(nav).getByRole('button',{name:'Cash'}));
  expect(navigate).toHaveBeenCalledExactlyOnceWith('finance_cash');
});
