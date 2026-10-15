import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {getModuleById,getPermissionDefinitions,getPermissionGroups,moduleRegistry} from '../../../../../config/modules.ts';
import {normalizeRoleOutletAccess,roleHasRestaurantPermissions} from '../../utils/roleAccess.js';

it('moves only Outlet presentation while preserving the Production permission catalogue',()=>{
 expect(new Set(moduleRegistry.map(m=>m.id)).size).toBe(moduleRegistry.length);
 expect(moduleRegistry).toHaveLength(119);
 expect(getPermissionGroups().flatMap(g=>g.modules)).toHaveLength(99);
 const codes=getPermissionDefinitions().map(p=>p.code).sort();
 expect(codes).toHaveLength(373);
 expect(createHash('sha256').update(JSON.stringify(codes)).digest('hex')).toBe('dde000d56fd9eb5b82f2440cd9d511e155b22bcdeefad265cbd2cb1939872475');
 expect(getModuleById('outlets')).toMatchObject({section:'System',route:'/operations/outlets',sidebar:true});
 expect(moduleRegistry.filter(m=>m.id==='outlets')).toHaveLength(1);
 expect(getModuleById('brands').section).toBe('System');
 expect(getModuleById('audit-logs').section).toBe('System');
});
it('retains Outlet-only role scope after the navigation move',()=>{
 expect(roleHasRestaurantPermissions(['outlets.view'])).toBe(true);
 expect(roleHasRestaurantPermissions(['roles.view'])).toBe(false);
 expect(normalizeRoleOutletAccess({permissions:['outlets.view'],outletAccess:'selected',selectedOutletIds:['outlet-a']},[{id:'outlet-a',name:'Outlet A'}])).toEqual({mode:'selected',outlets:[{id:'outlet-a',name:'Outlet A'}]});
});
