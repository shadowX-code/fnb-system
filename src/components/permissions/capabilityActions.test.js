import {it,expect} from 'vitest';
import {agentWorkspaceLabel,capabilityWorkspaceLabel} from './capabilityActions.js';
it('labels the actual granted workspaces independently of the retained Factory adapter',()=>{
 const agent={workspace:'Factory',business_capabilities:[{workspace:'Restaurant',granted:true},{workspace:'Factory',granted:false}]};expect(agentWorkspaceLabel(agent)).toBe('Restaurant');
 expect(agentWorkspaceLabel({...agent,business_capabilities:[...agent.business_capabilities,{workspace:'Factory',granted:true}]})).toBe('Factory · Restaurant');
 expect(agentWorkspaceLabel({workspace:'Factory',tools:[{workspace:'Factory',granted:true}]})).toBe('Factory');
 expect(capabilityWorkspaceLabel([{workspace:'Factory'},{workspace:'Restaurant'},{workspace:'Factory'}])).toBe('Factory · Restaurant');
});
