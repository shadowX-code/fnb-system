import { describe,it,expect } from 'vitest';
import { moduleRegistry,workspaceSwitcherOptions,getSidebarSections,getPermissionDefinitions } from '../../../config/modules.ts';
import { adminRouteDefinitions } from '../routeOwnership.js';
import { routeDetails } from '../routes.jsx';
import { roleHasRestaurantPermissions } from '../../features/company-users/utils/roleAccess.js';
describe('Marketing workspace ownership',()=>{
  it('is one launcher workspace with independent routes and explicit action permissions',()=>{
    expect(workspaceSwitcherOptions.filter(w=>w.id==='marketing')).toEqual([{id:'marketing',label:'Marketing',detail:'Brands, content & engagement',permission:'marketing_workspace.access'}]);
    const pages=moduleRegistry.filter(m=>m.workspace==='marketing'&&m.sidebar);
    expect(pages).toHaveLength(6);
    for(const page of pages){
      expect(adminRouteDefinitions.find(r=>r.id===page.id).ownership).toMatchObject({workspace:'marketing',domain:'marketing',surface:'admin'});
      expect(adminRouteDefinitions.find(r=>r.id===page.id).canonicalPath).toMatch(/^\/marketing\//);
      expect(routeDetails[page.id].permission).toContain('marketing_workspace.access AND');
    }
    expect(pages.find(p=>p.id==='marketing_inbox').permissions).toEqual({view:true,manage:true,reply:true,approve:true,configure:true,ai:true});
    expect(getPermissionDefinitions().filter(p=>p.code.startsWith('marketing_inbox.')).map(p=>p.code)).toEqual(expect.arrayContaining(['marketing_inbox.view','marketing_inbox.manage','marketing_inbox.reply','marketing_inbox.approve','marketing_inbox.configure','marketing_inbox.ai']));
    expect(getPermissionDefinitions().filter(p=>p.code.startsWith('marketing_inbox.'))).toHaveLength(6);
    expect(getSidebarSections('restaurant').flatMap(s=>s.items).some(i=>i.id?.startsWith('marketing_'))).toBe(false);
    expect(roleHasRestaurantPermissions(['marketing_content.publish','platform_organizations.manage'])).toBe(false);
  });
});
