import {expect,it} from 'vitest';
import {newFlow,insertFlowStep,flowTurn,flowIssues} from '../aiFlowDefinition.js';

it('collects typed details and follows the configured branch on the same graph used by the editor',()=>{
 let flow={...newFlow(),name:'A custom visit flow',intent:'visit',channels:['instagram']};
 flow=insertFlowStep(flow,'trigger','next','ask');
 const ask=flow.nodes[1];
 Object.assign(ask,{field:'guests',prompt:'How many guests?',value_type:'number'});
 flow=insertFlowStep(flow,ask.id,'next','condition');
 const condition=flow.nodes[2];
 Object.assign(condition,{field:'guests',equals:'8'});
 flow=insertFlowStep(flow,condition.id,'yes','handoff');
 Object.assign(flow.nodes[3],{prompt:'I will pass this to the team.'});
 expect(flowIssues(flow)).toEqual({});
 const waiting=flowTurn(flow);
 expect(waiting).toMatchObject({status:'collect',step:ask.id});
 expect(flowTurn(flow,waiting,'several')).toMatchObject({status:'collect',text:expect.stringContaining('number')});
 expect(flowTurn(flow,waiting,'8')).toMatchObject({status:'handoff',fields:{guests:'8'}});
 expect(flowTurn(flow,waiting,'2')).toMatchObject({status:'completed',fields:{guests:'2'}});
});
