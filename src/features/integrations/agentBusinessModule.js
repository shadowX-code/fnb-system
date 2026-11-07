import hrModules from '../../../config/hrAgentModules.json';
import {getModuleById,moduleRegistry} from '../../../config/modules.ts';

// Agent resource IDs are transport identities; links still resolve to canonical navigation.
export function agentBusinessModule(id) {
 const direct=getModuleById(id);
 if(direct)return direct;
 const route=hrModules.find(module=>module.id===id)?.route;
 return route?moduleRegistry.find(module=>module.route===route&&module.sidebar):undefined;
}
