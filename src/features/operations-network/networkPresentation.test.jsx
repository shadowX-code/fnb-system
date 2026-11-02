import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkEdge } from './NetworkGraph.jsx';
import { buildNetwork } from './networkModel.js';
import { presentNetworkEdges } from './networkPresentation.js';

const modules = ['restaurant','factory','hr','crew','finance','marketing','guest_ai'].flatMap(workspace => Array.from({length: 5},(_,i)=>({id:`${workspace}-${i}`,label:`${workspace} operation ${i}`,workspace,section:'Operations'})));
const overlap = (a,b) => a.position.x < b.position.x+b.width && a.position.x+a.width > b.position.x && a.position.y < b.position.y+b.height && a.position.y+a.height > b.position.y;

describe('readable network layout', () => {
  it('fits a seven-workspace overview in a ordered layers without overlapping node bounds', () => {
    const graph=buildNetwork({modules});
    expect(Math.max(...graph.nodes.map(node=>node.position.x+node.width))-Math.min(...graph.nodes.map(node=>node.position.x))).toBeLessThanOrEqual(1100);
    expect(Math.max(...graph.nodes.map(node=>node.position.y+node.height))).toBeLessThan(800);
    for(const [index,node] of graph.nodes.entries()) for(const other of graph.nodes.slice(index+1)) expect(overlap(node,other),`${node.id} overlaps ${other.id}`).toBe(false);
    expect(graph.nodes.find(node=>node.id==='platform').width).toBeGreaterThan(graph.nodes.find(node=>node.data.kind==='workspace').width);
  });
  it('orders platform, workspace rows, automation and data vertically', () => {
    const graph=buildNetwork({modules});
    const find=id=>graph.nodes.find(node=>node.id===id);
    const workspaces=graph.nodes.filter(node=>node.data.kind==='workspace');
    expect(new Set(workspaces.map(node=>node.position.y)).size).toBe(2);
    expect(Math.min(...workspaces.map(node=>node.position.y))).toBeGreaterThan(find('platform').height);
    expect(find('automation-group').position.y).toBeGreaterThan(Math.max(...workspaces.map(node=>node.position.y+node.height)));
    expect(find('data-group').position.y).toBeGreaterThan(find('automation-group').position.y+find('automation-group').height);
    const focused=presentNetworkEdges(graph.edges,false,'workspace:factory');
    expect(focused.filter(edge=>!edge.data.dimmed).every(edge=>edge.source==='workspace:factory'||edge.target==='workspace:factory')).toBe(true);
  });
  it('keeps expanded modules in their own grid and preserves unique evidenced edges for different actors', () => {
    const agents=['one','two'].map(id=>({id,name:id,status:'observed',workspaces:['factory'],moduleIds:['factory-0']}));
    const events=agents.map(agent=>({id:agent.id,agentId:agent.id,date:new Date().toISOString(),status:'running',moduleIds:['factory-0'],workspaces:['factory']}));
    const graph=buildNetwork({modules,agents,events,expanded:new Set(['factory'])});
    for(const [index,node] of graph.nodes.entries()) for(const other of graph.nodes.slice(index+1)) expect(overlap(node,other),`${node.id} overlaps ${other.id}`).toBe(false);
    const executions=graph.edges.filter(edge=>edge.data.kind==='execution');
    expect(new Set(executions.map(edge=>edge.id)).size).toBe(2);
    expect(executions.map(edge=>edge.data.agentId)).toEqual(['one','two']);
    expect(graph.edges.every(edge=>graph.nodes.some(node=>node.id===edge.source)&&graph.nodes.some(node=>node.id===edge.target))).toBe(true);
  });
  it('keeps one workspace usable in a narrow viewport and focuses the primary fan when viewing all', () => {
    const graph=buildNetwork({modules,workspace:'hr',narrow:true});
    expect(Math.max(...graph.nodes.map(node=>node.position.x+node.width))-Math.min(...graph.nodes.map(node=>node.position.x))).toBeLessThanOrEqual(350);
    expect(buildNetwork({modules,narrow:true}).primaryIds).toHaveLength(3);
  });
  it('routes expanded member and operation edges with finite SVG coordinates and explicit ports', () => {
    const graph=buildNetwork({modules,agents:[{id:'a',name:'Agent',status:'observed',workspaces:['restaurant'],moduleIds:['restaurant-0']}],expanded:new Set(['restaurant','agents','data-integrations'])});
    const anchor=(node,handle)=>{const side=handle.split('-')[1];return {x:node.position.x+(side==='left'?0:side==='right'?node.width:node.width/2),y:node.position.y+(side==='top'?0:side==='bottom'?node.height:node.height/2),side};};
    for(const edge of graph.edges){
      const source=anchor(graph.nodes.find(node=>node.id===edge.source),edge.sourceHandle),target=anchor(graph.nodes.find(node=>node.id===edge.target),edge.targetHandle);
      const output=renderToStaticMarkup(<svg><NetworkEdge {...edge} sourceX={source.x} sourceY={source.y} targetX={target.x} targetY={target.y} sourcePosition={source.side} targetPosition={target.side}/></svg>);
      expect(output,edge.id).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('evidence and synthetic motion separation', () => {
  it('adds bounded demo rendering flags without altering source evidence or execution edges', () => {
    const graph=buildNetwork({modules});
    const original=JSON.stringify(graph);
    const real={id:'real',source:'platform',target:'workspace:factory',data:{kind:'execution',status:'failed',eventId:'canonical',date:'2026-11-03T00:00:00Z'}};
    const demo=presentNetworkEdges([...graph.edges,real],true);
    expect(JSON.stringify(graph)).toBe(original);
    expect(demo.filter(edge=>edge.data.demoMotion).length).toBeLessThanOrEqual(5);
    expect(demo.some(edge=>edge.data.demoMotion)).toBe(true);
    expect(demo.at(-1).data).toEqual({...real.data,demoMotion:false,dimmed:false});
    expect(presentNetworkEdges(graph.edges,false).every(edge=>!edge.data.demoMotion)).toBe(true);
  });
  it.each([
    ['idle','dependency',false,false,0], ['pending','execution',false,false,0], ['failed','execution',false,false,0],
    ['unknown','execution',false,false,0], ['running','execution',false,false,3], ['completed','execution',true,false,3],
    ['completed','execution',false,false,0], ['idle','dependency',false,true,3],
  ])('renders %s particles only with running/fresh completion evidence or explicit demo', (status,kind,fresh,demoMotion,count) => {
    const output=renderToStaticMarkup(<svg><NetworkEdge id="test" sourceX={0} sourceY={0} targetX={250} targetY={200} sourcePosition="bottom" targetPosition="top" data={{status,kind,fresh,demoMotion,routing:'curve'}} /></svg>);
    expect((output.match(/class="son-motion-particle/g)||[]).length).toBe(count);
    if(count) expect(output).toContain(`data-motion-source="${demoMotion?'synthetic-demo':'recorded-execution'}"`);
    expect(output).not.toContain('NaN');
  });
});
