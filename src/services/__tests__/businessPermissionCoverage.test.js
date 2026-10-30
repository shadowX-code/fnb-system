import {describe,it,expect} from 'vitest';
import {moduleRegistry,getPermissionGroups,getPermissionDefinitions,permissionActionOrder,moduleWorkspace} from '../../../config/modules.ts';
describe('implemented business permission coverage',()=>{
 const groups=getPermissionGroups().flatMap(group=>group.modules);
 it('exposes existing HR document and Factory verification authorities without new routes',()=>{
  for(const id of ['employee_disciplinary','employee_employment_documents','employment_contract_templates']){
   expect(moduleRegistry.find(module=>module.id===id)).toMatchObject({sidebar:false,routable:false,workspace:'hr'});
   expect(groups.find(group=>group.key===id).actions.manage.codes).toEqual([`${id}.view`,`${id}.manage`]);
  }
  for(const id of ['factory_production','factory_raw_receiving'])expect(groups.find(group=>group.key===id).actions.verify.codes).toEqual([`${id}.view`,`${id}.verify`]);
 });
 it('keeps canonical feedback namespaces and precise follow-up read/manage dependencies',()=>{
  expect(groups.find(group=>group.key==='crew_customer_feedback').actions.correct_attribution.codes).toEqual(['crew_feedback.view','crew_feedback.correct_attribution']);
  expect(groups.find(group=>group.key==='crew_feedback_follow_up').actions.manage.codes).toEqual(['crew_feedback.follow_up.view','crew_feedback.follow_up.manage']);
 });
 it('generates unique supported actions and leaves Finance contracts untouched',()=>{
  const codes=getPermissionDefinitions().map(p=>p.code);expect(new Set(codes).size).toBe(codes.length);
  for(const module of moduleRegistry)for(const action of Object.keys(module.permissions))expect(permissionActionOrder).toContain(action);
  const finance=moduleRegistry.filter(module=>moduleWorkspace(module)==='finance');expect(finance).toHaveLength(7);
  for(const module of finance){expect(module.permissions).toEqual({});expect(module.readPermission).toBe('reports.view');}
 });
});
