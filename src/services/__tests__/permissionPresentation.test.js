import {roleHasRestaurantPermissions,normalizeRoleOutletAccess} from '../../features/company-users/utils/roleAccess.js';
import { describe, expect, it } from 'vitest';
import { getModuleById, getPermissionDefinitions, getPermissionGroups, permissionPresentationOverrides, permissionActionLabels } from '../../../config/modules.ts';

describe('permission presentation overrides', () => {
  it('uses canonical labels and implied view grants without globally reinterpreting Manage', () => {
    const groups = getPermissionGroups().flatMap(group => group.modules);
    for (const [code, presentation] of Object.entries(permissionPresentationOverrides)) {
      const [id, action] = code.split('.');
      const cell = groups.find(row => row.key === id).actions[action];
      expect(cell.label).toBe(presentation.label);
      expect(cell.codes).toEqual(action !== "view" && getModuleById(id).permissions.view ? [`${id}.view`, code] : [code]);
      expect(getPermissionDefinitions().find(row => row.code === code).description).toBe(presentation.description);
    }
    expect(Object.keys(permissionPresentationOverrides).filter(code => !code.startsWith('payroll.') && !code.startsWith('crew_google_reviews.'))).toEqual(['marketing_inbox.configure', 'marketing_inbox.approve', 'marketing_settings.configure', 'marketing_settings.manage', 'platform_organizations.manage', 'marketing_content.publish', 'marketing_content.execute', 'crew_leave_settings.manage', 'factory_petty_cash.manage']);
    expect(permissionActionLabels.manage).toBe('Manage');
    expect(groups.find(row => row.key === 'payroll').actions.manage).toBeUndefined();
    expect(groups.find(row => row.key === 'payroll').actions.prepare.label).toBe('Prepare Payroll Runs');
  });
});

 it('registers Google Reviews as six independent actions under Performance',()=>{
 const row=getPermissionGroups().flatMap(g=>g.modules).find(m=>m.key==='crew_google_reviews');
 expect(Object.keys(row.actions).sort()).toEqual(['edit_reply','manage_connection','manage_mapping','publish_reply','sync','view']);
 expect(row.actions.view.label).toBe('View Reviews');expect(row.actions.sync.label).toBe('Sync Reviews');
 for(const [key,cell] of Object.entries(row.actions))expect(cell.codes).toEqual([...new Set(['crew_google_reviews.view',`crew_google_reviews.${key}`])]);
 });

 it('retains canonical outlet scope for a Google-only role without broad Performance access',()=>{
 expect(roleHasRestaurantPermissions(['crew_google_reviews.view'])).toBe(true);
 expect(normalizeRoleOutletAccess({permissions:['crew_google_reviews.view'],outlet_access_type:'selected',selectedOutletIds:['one']},[{id:'one',name:'One'}])).toEqual({mode:'selected',outlets:[{id:'one',name:'One'}]});
 expect(roleHasRestaurantPermissions(['crew_performance.view'])).toBe(false);
 });
