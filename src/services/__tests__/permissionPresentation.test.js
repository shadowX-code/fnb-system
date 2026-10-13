import { describe, expect, it } from 'vitest';
import { getPermissionDefinitions, getPermissionGroups, permissionPresentationOverrides, permissionActionLabels, getModuleById, moduleRegistry, enabledActions } from '../../../config/modules.ts';

describe('permission presentation overrides', () => {
  it('uses canonical labels and implied view grants without globally reinterpreting Manage', () => {
    const groups = getPermissionGroups().flatMap(group => group.modules);
    for (const [code, presentation] of Object.entries(permissionPresentationOverrides)) {
      const [id, action] = code.split('.');
      const cell = groups.find(row => row.key === id).actions[action];
      expect(cell.label).toBe(presentation.label);
      expect(cell.codes).toEqual(getModuleById(id).permissions.view ? [`${id}.view`, code] : [code]);
      expect(getPermissionDefinitions().find(row => row.code === code).description).toBe(presentation.description);
    }
    expect(Object.keys(permissionPresentationOverrides).filter(code => !code.startsWith('payroll.'))).toEqual(['marketing_inbox.configure', 'marketing_inbox.approve', 'marketing_settings.configure', 'marketing_settings.manage', 'platform_organizations.manage', 'marketing_content.publish', 'marketing_content.execute', 'crew_leave_settings.manage', 'factory_petty_cash.manage']);
    expect(permissionActionLabels.manage).toBe('Manage');
    expect(groups.find(row => row.key === 'payroll').actions.manage).toBeUndefined();
    expect(groups.find(row => row.key === 'payroll').actions.prepare.label).toBe('Prepare Payroll Runs');
  });
});

 it('matrix cells reference only registered permission codes and standalone Access has no phantom View',()=>{
 const registered=new Set(getPermissionDefinitions().map(p=>p.code));
 for(const module of getPermissionGroups().flatMap(g=>g.modules))for(const cell of Object.values(module.actions))for(const code of cell.codes)expect(registered.has(code),code).toBe(true);
 expect(getPermissionGroups().flatMap(g=>g.modules).find(m=>m.key==='marketing_workspace').actions.access.codes).toEqual(['marketing_workspace.access']);
 });

 it('registers every declared Marketing action including the existing Ads connection grant',()=>{
 for(const module of moduleRegistry.filter(m=>m.workspace==='marketing'))expect(enabledActions(module).sort()).toEqual(Object.keys(module.permissions).filter(k=>module.permissions[k]).sort());
 expect(getPermissionDefinitions().some(p=>p.code==='marketing_ads.connect')).toBe(true);
 });
