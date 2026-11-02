import { describe, expect, it } from 'vitest';
import { buildNetwork } from './networkModel.js';
import { presentNetworkEdges } from './networkPresentation.js';
import { roundedRoute, segmentBlocked } from './networkRouting.js';
const modules=['restaurant','factory','hr','crew','finance','marketing','guest_ai'].flatMap(workspace=>Array.from({length:14},(_,i)=>({id:`${workspace}-${i}`,label:`Operation ${i}`,workspace,section:'Operations'})));
const agents=Array.from({length:4},(_,i)=>({id:`a${i}`,name:`Agent ${i}`,status:'observed',workspaces:['factory'],moduleIds:['factory-0','factory-1']}));
const integrations=Array.from({length:6},(_,i)=>({id:`social:${i}`,label:`Connection ${i}`,workspace:'marketing',status:'unknown'}));
const options={modules,agents,integrations};
const bodies=graph=>graph.nodes.filter(n=>!['operation-group','agent-group','data-group'].includes(n.data.kind));
function verify(graph){
  for(const edge of graph.edges){
    const points=edge.data.routePoints;
    expect(roundedRoute(points)).not.toMatch(/NaN|Infinity|undefined/);
    for(const node of bodies(graph).filter(n=>n.id!==edge.source&&n.id!==edge.target)){
      const box={left:node.position.x,right:node.position.x+node.width,top:node.position.y,bottom:node.position.y+node.height};
      for(let i=1;i<points.length;i++)expect(segmentBlocked(points[i-1],points[i],[box]),`${edge.id} crosses ${node.id}`).toBe(false);
    }
    const visited=new Set(points.map(p=>`${p.x},${p.y}`));expect(visited.size).toBe(points.length);
  }
}
describe('shared obstacle routing and multi-layer demo',()=>{
  it.each([{},{expanded:new Set(['factory'])},{narrow:true},{workspace:'factory',narrow:true,expanded:new Set(['factory'])},{search:'Operation 1'}])('avoids node bodies after layout changes %j',change=>verify(buildNetwork({...options,...change})));
  it('routes L1 to L5 through a nearby free channel with correct ports',()=>{
    const graph=buildNetwork(options),edge=graph.edges.find(e=>e.source==='platform'&&e.target==='data-platform');
    expect(edge.sourceHandle).toBe('out-bottom');expect(edge.targetHandle).toBe('in-top');
    expect(Math.min(...edge.data.routePoints.map(p=>p.x))).toBeGreaterThanOrEqual(0);
    expect(edge.data.routePoints.length).toBeLessThanOrEqual(8);
  });
  it('covers every existing layer/semantic pair without creating execution evidence',()=>{
    const graph=buildNetwork({...options,expanded:new Set(['factory'])});
    const demo=presentNetworkEdges(graph.edges,true);
    const key=e=>`${e.data.sourceLayer}:${e.data.targetLayer}:${e.data.kind}`;
    expect(new Set(demo.filter(e=>e.data.demoMotion).map(key))).toEqual(new Set(graph.edges.filter(e=>e.data.kind!=='execution').map(key)));
    expect(demo.filter(e=>e.data.demoMotion).length).toBeLessThanOrEqual(10);
    expect(demo.filter(e=>e.data.demoMotion).some(e=>e.data.kind==='authorization')).toBe(true);
    expect(presentNetworkEdges(graph.edges,false).every(e=>!e.data.demoMotion)).toBe(true);
  });
  it('chooses an on-screen operation rather than an off-screen alphabetical match',()=>{
    const graph=buildNetwork({...options,expanded:new Set(['factory'])});
    const demo=presentNetworkEdges(graph.edges,true,null,['operations:factory','factory-9']);
    expect(demo.find(edge=>edge.data.demoMotion&&edge.data.sourceLayer===2&&edge.data.targetLayer===2).target).toBe('factory-9');
  });
  it('reuses identical paths during ordinary evidence/focus refreshes',()=>{
    const a=buildNetwork(options),b=buildNetwork({...options,selectedId:'agent:a0',now:Date.now()+12000});
    expect(b.edges.map(e=>e.data.routePoints)).toEqual(a.edges.map(e=>e.data.routePoints));
    expect(b.edges[0].data.routePoints).toBe(a.edges[0].data.routePoints);
  });
});
