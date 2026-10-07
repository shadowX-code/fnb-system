import { describe, expect, it } from 'vitest';
import { getPermissionDefinitions, getPermissionGroups, permissionPresentationOverrides, permissionActionLabels } from '../../../config/modules.ts';

describe('permission presentation overrides', () => {
  it('uses canonical labels and implied view grants without globally reinterpreting Manage', () => {
    const groups = getPermissionGroups().flatMap(group => group.modules);
    for (const [code, presentation] of Object.entries(permissionPresentationOverrides)) {
      const [id, action] = code.split('.');
      const cell = groups.find(row => row.key === id).actions[action];
      expect(cell.label).toBe(presentation.label);
      expect(cell.codes).toEqual([`${id}.view`, code]);
      expect(getPermissionDefinitions().find(row => row.code === code).description).toBe(presentation.description);
    }
    expect(Object.keys(permissionPresentationOverrides).filter(code => !code.startsWith('payroll.'))).toEqual(['crew_leave_settings.manage', 'factory_petty_cash.manage']);
    expect(permissionActionLabels.manage).toBe('Manage');
    expect(groups.find(row => row.key === 'payroll').actions.manage).toBeUndefined();
    expect(groups.find(row => row.key === 'payroll').actions.prepare.label).toBe('Prepare Payroll Runs');
  });
});
