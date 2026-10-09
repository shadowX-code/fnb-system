import { describe,it,expect } from 'vitest';
import { moduleRegistry,workspaceSwitcherOptions,getSidebarSections } from '../../../config/modules.ts';
import { adminRouteDefinitions } from '../routeOwnership.js';
import { routeDetails } from '../routes.jsx';
import { roleHasRestaurantPermissions } from '../../features/company-users/utils/roleAccess.js';
describe('Marketing workspace ownership',()=>{
  it('is one launcher workspace with independent routes and explicit action permissions',()=>{
    expect(workspaceSwitcherOptions.filter(w=>w.id==='marketing')).toEqual([{id:'marketing',label:'Marketing',detail:'Brands, content & engagement',permission:'marketing_workspace.access'}]);
    const pages=moduleRegistry.filter(m=>m.workspace==='marketing'&&m.sidebar);
    expect(pages).toHaveLength(5);
    for(const page of pages){
      expect(adminRouteDefinitions.find(r=>r.id===page.id).ownership).toMatchObject({workspace:'marketing',domain:'marketing',surface:'admin'});
      expect(adminRouteDefinitions.find(r=>r.id===page.id).canonicalPath).toMatch(/^\/marketing\//);
      expect(routeDetails[page.id].permission).toContain('marketing_workspace.access AND');
    }
    expect(getSidebarSections('restaurant').flatMap(s=>s.items).some(i=>i.id?.startsWith('marketing_'))).toBe(false);
    expect(roleHasRestaurantPermissions(['marketing_content.publish','platform_organizations.manage'])).toBe(false);
  });
});
