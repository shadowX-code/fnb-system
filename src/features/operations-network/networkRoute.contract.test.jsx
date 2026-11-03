import { expect, it } from 'vitest';
import { moduleRegistry } from '../../../config/modules.ts';
import { routeDetails, salesPurchaseRoutes } from '../../app/routes.jsx';
import { getAdminRouteDefinition, resolveAdminLocation } from '../../app/routeOwnership.js';

it('owns one lazy, authenticated Admin Network route without adding a sidebar or business permission grant',()=>{
  const module=moduleRegistry.find(row=>row.id==='operations_network');
  expect(module).toMatchObject({route:'/system/operations-network',sidebar:false,permissions:{},readPermission:''});
  expect(getAdminRouteDefinition('operations_network')).toMatchObject({canonicalPath:'/system/operations-network',ownership:{domain:'system',moduleId:'operations_network'}});
  expect(salesPurchaseRoutes.filter(row=>row.id==='operations_network')).toHaveLength(1);
  expect(routeDetails.operations_network.permission).toBe('');
  expect(routeDetails.operations_network.component.$$typeof).toBe(Symbol.for('react.lazy'));
});

it('resolves direct and compatibility Network navigation without treating demo query strings as product state',()=>{
  expect(resolveAdminLocation({pathname:'/system/operations-network',search:'?demo=1&visualDemo=true&synthetic=true',hash:''})).toMatchObject({routeId:'operations_network',query:{},source:'pathname'});
  expect(resolveAdminLocation({pathname:'/',search:'',hash:'#operations_network'})).toMatchObject({routeId:'operations_network'});
});
