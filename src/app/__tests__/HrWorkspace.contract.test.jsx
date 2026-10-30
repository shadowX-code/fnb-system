import {describe,it,expect} from 'vitest';
import {getSidebarSections,moduleRegistry,getPermissionDefinitions,workspaceSwitcherOptions} from '../../../config/modules.ts';
import {resolveCanonicalPath,getAdminRouteDefinition,canonicalPathForRoute,resolveLegacyHash,canonicalAdminUrlForLegacyLocation} from '../routeOwnership.js';
import {salesPurchaseRoutes} from '../routes.jsx';

describe('HR workspace composition',()=>{
 it('moves the canonical modules without duplicating identities or permission codes',()=>{
  expect(getSidebarSections('hr').map(s=>[s.label,s.items.map(i=>i.label)])).toEqual([
   ['Overview',['Dashboard']],['People',['Employees','Recruitment','Payroll']],
   ['Organization',['Legal Entities','Departments','Job Positions']],['Compliance',['Food Handling Compliance']],
   ['Settings',['Roles & Permissions','AI Integrations']],
  ]);
  for(const id of ['employees','recruitment','payroll','legal-entities','departments','job-positions','employee_compliance']){
   expect(moduleRegistry.filter(m=>m.id===id)).toHaveLength(1);
   expect(getAdminRouteDefinition(id).ownership.workspace).toBe('hr');
   expect(getSidebarSections('restaurant').flatMap(s=>s.items).some(i=>i.id===id)).toBe(false);
  }
  expect(getPermissionDefinitions().filter(p=>p.code.startsWith('hr_'))).toEqual([]);
  const permissions=getPermissionDefinitions().map(p=>p.code);
  expect(new Set(permissions).size).toBe(permissions.length);
 });
 it('keeps People links, nested document URLs and old integration entry on the same owners',()=>{
  expect(resolveCanonicalPath('/people/employees','?employee=abc&section=employment').routeId).toBe('employees');
  expect(resolveCanonicalPath('/people/recruitment').routeId).toBe('recruitment');
  expect(getAdminRouteDefinition(resolveCanonicalPath('/people/payroll').routeId).ownership.workspace).toBe('hr');
  expect(resolveCanonicalPath('/people/legal-entities/abc/contract-templates').routeId).toBe('legal-entities');
  expect(resolveCanonicalPath('/system/settings/integrations/external-agents').routeId).toBe('external_agents');
  expect(canonicalPathForRoute('external_agents')).toBe('/system/settings/ai-integrations');
  expect(getAdminRouteDefinition(resolveCanonicalPath('/people/roles').routeId).ownership.domain).toBe('system');
 });
 it('retires Settings without a second page while preserving saved links',()=>{
  expect(moduleRegistry.some(module=>module.id==='hr_settings')).toBe(false);
  expect(salesPurchaseRoutes.some(route=>route.id==='hr_settings')).toBe(false);
  expect(resolveCanonicalPath('/hr/settings').routeId).toBe('hr_dashboard');
  expect(resolveLegacyHash('#hr_settings').routeId).toBe('hr_dashboard');
  expect(canonicalPathForRoute('hr_dashboard')).toBe('/hr/dashboard');
  expect(canonicalPathForRoute('employees',{}, {company:'entity-1'})).toBe('/people/employees?company=entity-1');
  expect(resolveCanonicalPath('/people/payroll','?company=entity-1&period=2026-09&run=run-1').query).toEqual({company:'entity-1',period:'2026-09',run:'run-1'});
 });
 it('reuses existing view permissions without broadening agent or business authority',()=>{
  const hr=workspaceSwitcherOptions.find(w=>w.id==='hr');
  expect(hr.permission).toContain('employees.view OR recruitment.view OR payroll.view');
  expect(salesPurchaseRoutes.find(r=>r.id==='external_agents').permission).toBe('roles.view OR roles_permissions.view');
  expect(salesPurchaseRoutes.find(r=>r.id==='payroll').permission).toBe('payroll.view');
  expect(moduleRegistry.find(m=>m.id==='roles').sidebar).toBe(false);
 });
 it('retires the System directory while preserving platform-wide roles and integration routes',()=>{
  expect(moduleRegistry.some(module=>module.id==='system_settings')).toBe(false);
  expect(salesPurchaseRoutes.some(route=>route.id==='system_settings')).toBe(false);
  expect(resolveCanonicalPath('/system/settings').routeId).toBe('roles');
  expect(canonicalAdminUrlForLegacyLocation({pathname:'/system/settings/',search:'?qa=retained'})).toBe('/people/roles?qa=retained');
  expect(resolveLegacyHash('#system_settings').routeId).toBe('roles');
  expect(resolveCanonicalPath('/system/roles').routeId).toBe('roles');
  expect(canonicalPathForRoute('system_settings')).toBe('/people/roles');
  expect(resolveCanonicalPath('/people/roles/role-1/edit').routeId).toBe('roles');
  expect(resolveLegacyHash('#roles/role-1/edit').params.roleId).toBe('role-1');
  expect(getAdminRouteDefinition('roles').ownership).toMatchObject({domain:'system',permission:'roles.view',workspace:'restaurant'});
 });

});
