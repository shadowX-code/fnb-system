import {it,expect} from 'vitest';
import {moduleRegistry,workspaceSwitcherOptions,getPermissionGroups,getPermissionDefinitions} from '../../../config/modules.ts';
import {resolveCanonicalPath} from '../routeOwnership.js';
it('isolates HR without introducing deferred workspaces or Recruitment',()=>{
 for(const id of ['finance','guest_ai','recruitment']){expect(moduleRegistry.some(m=>m.workspace===id||m.id===id)).toBe(false);expect(workspaceSwitcherOptions.some(m=>m.id===id)).toBe(false);}
 expect(getPermissionDefinitions().some(p=>/^(guest_ai|recruitment)\./.test(p.code))).toBe(false);
 expect(getPermissionGroups().flatMap(g=>g.modules).some(m=>m.key.startsWith('factory_agent_')||m.key==='factory_mesti_inspection')).toBe(false);
 expect(resolveCanonicalPath('/system/settings/integrations/external-agents').routeId).toBe('external_agents');
 expect(resolveCanonicalPath('/people/roles','?permission_workspace=factory').query).toEqual({permission_workspace:'factory'});
});
