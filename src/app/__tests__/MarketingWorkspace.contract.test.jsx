import { describe,it,expect } from 'vitest';
import { moduleRegistry,workspaceSwitcherOptions,getSidebarSections,getPermissionDefinitions } from '../../../config/modules.ts';
import { adminRouteDefinitions } from '../routeOwnership.js';
import { routeDetails } from '../routes.jsx';
import { roleHasRestaurantPermissions } from '../../features/company-users/utils/roleAccess.js';
describe('Marketing workspace ownership',()=>{
  it('allows audience viewers into the unified page without granting campaign actions',()=>{
    const permission=routeDetails.marketing_campaigns.permission;
    const allows=codes=>permission.split(' OR ').some(clause=>clause.split(' AND ').every(code=>codes.includes(code)));
    expect(allows(['marketing_workspace.access','marketing_audience.view'])).toBe(true);
    expect(allows(['marketing_audience.view'])).toBe(false);
    expect(allows(['marketing_workspace.access','marketing_campaigns.view'])).toBe(true);
  });
  it('is one launcher workspace with independent routes and explicit action permissions',()=>{
    expect(workspaceSwitcherOptions.filter(w=>w.id==='marketing')).toEqual([{id:'marketing',label:'Marketing',detail:'Brands, content & engagement',permission:'marketing_workspace.access'}]);
    const pages=moduleRegistry.filter(m=>m.workspace==='marketing'&&m.sidebar);
    expect(pages).toHaveLength(7);
    for(const page of pages){
      expect(adminRouteDefinitions.find(r=>r.id===page.id).ownership).toMatchObject({workspace:'marketing',domain:'marketing',surface:'admin'});
      expect(adminRouteDefinitions.find(r=>r.id===page.id).canonicalPath).toMatch(/^\/marketing\//);
      expect(routeDetails[page.id].permission).toContain('marketing_workspace.access AND');
    }
    expect(pages.find(p=>p.id==='marketing_inbox').permissions).toEqual({view:true,manage:true,reply:true,approve:true,configure:true,ai:true,send:true});
    expect(getPermissionDefinitions().filter(p=>p.code.startsWith('marketing_inbox.')).map(p=>p.code)).toEqual(expect.arrayContaining(['marketing_inbox.view','marketing_inbox.manage','marketing_inbox.reply','marketing_inbox.approve','marketing_inbox.configure','marketing_inbox.ai','marketing_inbox.send']));
    expect(getPermissionDefinitions().filter(p=>p.code.startsWith('marketing_inbox.'))).toHaveLength(7);
    expect(getSidebarSections('marketing').map(s=>s.label)).toEqual(['Overview','Content Studio','Inbox','Audience & Campaigns','Analytics','Settings']);
    expect(getSidebarSections('restaurant').flatMap(s=>s.items).some(i=>i.id?.startsWith('marketing_'))).toBe(false);
    expect(roleHasRestaurantPermissions(['marketing_content.publish','platform_organizations.manage'])).toBe(false);
  });
});
