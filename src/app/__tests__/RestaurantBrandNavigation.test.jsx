import {it,expect} from 'vitest';
import {getSidebarSections,moduleRegistry} from '../../../config/modules.ts';
import {adminRouteDefinitions} from '../routeOwnership.js';
import {routeDetails} from '../routes.jsx';
import {roleHasRestaurantPermissions} from '../../features/company-users/utils/roleAccess.js';
it('owns Brands/Outlets/Audit Logs once under Restaurant System, retaining Outlet paths',()=>{expect(getSidebarSections('restaurant').find(s=>s.label==='System').items.map(i=>i.label)).toEqual(['Brands','Outlets','Audit Logs']);expect(moduleRegistry.filter(m=>m.id==='outlets')).toHaveLength(1);expect(moduleRegistry.find(m=>m.id==='outlets').route).toBe('/operations/outlets');expect(adminRouteDefinitions.find(r=>r.id==='outlets').canonicalPath).toBe('/restaurant/operations/outlets');expect(routeDetails.brands.permission).toBe('platform_organizations.manage');expect(roleHasRestaurantPermissions(['outlets.view'])).toBe(true);expect(roleHasRestaurantPermissions(['platform_organizations.manage'])).toBe(false)});
