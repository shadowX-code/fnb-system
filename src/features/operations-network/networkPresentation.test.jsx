import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkEdge } from './NetworkGraph.jsx';
import { buildNetwork } from './networkModel.js';
import { ambientEdgeBudget, deriveNetworkFocus, presentNetworkEdges } from './networkPresentation.js';

const modules = ['restaurant','factory','hr','crew','finance','marketing','guest_ai'].flatMap(workspace => Array.from({length: 5},(_,i)=>({id:`${workspace}-${i}`,label:`${workspace} operation ${i}`,workspace,section:'Operations'})));
const overlap = (a,b) => a.position.x < b.position.x+b.width && a.position.x+a.width > b.position.x && a.position.y < b.position.y+b.height && a.position.y+a.height > b.position.y;

describe('readable network layout', () => {
  it('fits a seven-workspace overview in a ordered layers without overlapping node bounds', () => {
    const graph=buildNetwork({modules});
    expect(Math.max(...graph.nodes.map(node=>node.position.x+node.width))-Math.min(...graph.nodes.map(node=>node.position.x))).toBeLessThanOrEqual(1550);
    expect(Math.max(...graph.nodes.map(node=>node.position.y+node.height))).toBeLessThan(800);
    for(const [index,node] of graph.nodes.entries()) for(const other of graph.nodes.slice(index+1)) expect(overlap(node,other),`${node.id} overlaps ${other.id}`).toBe(false);
    expect(graph.nodes.find(node=>node.id==='platform').width).toBeGreaterThan(graph.nodes.find(node=>node.data.kind==='workspace').width);
  });
  it('orders platform, workspace rows, automation and data vertically', () => {
    const graph=buildNetwork({modules});
    const find=id=>graph.nodes.find(node=>node.id===id);
    const workspaces=graph.nodes.filter(node=>node.data.kind==='workspace');
    expect(new Set(workspaces.map(node=>node.position.y)).size).toBe(1);
    for (const node of workspaces.filter(node=>node.position.y>190)) expect(graph.edges.find(edge=>edge.source==='platform'&&edge.target===node.id).data.routing).toBe('workspace-column');
    expect(Math.min(...workspaces.map(node=>node.position.y))).toBeGreaterThan(find('platform').height);
    expect(find('automation-group').position.y).toBeGreaterThan(Math.max(...workspaces.map(node=>node.position.y+node.height)));
    expect(find('data-group').position.y).toBeGreaterThan(find('automation-group').position.y+find('automation-group').height);
    const focused=presentNetworkEdges(graph.edges,false,'workspace:factory',[],deriveNetworkFocus(graph,'workspace:factory'));
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
    expect(demo.at(-1).data).toEqual({...real.data,ambientMotion:false,demoMotion:false,dimmed:false,focused:false});
    expect(presentNetworkEdges(graph.edges,false).every(edge=>!edge.data.demoMotion)).toBe(true);
  });
  it.each([
    ['idle','dependency',false,false,0], ['pending','execution',false,false,0], ['failed','execution',false,false,0],
    ['unknown','execution',false,false,0], ['running','execution',false,false,3], ['completed','execution',true,false,3],
    ['completed','execution',false,false,0], ['idle','dependency',false,true,3],
  ])('renders %s particles only with running/fresh completion evidence or explicit demo', (status,kind,fresh,demoMotion,count) => {
    const output=renderToStaticMarkup(<svg><NetworkEdge id="test" sourceX={0} sourceY={0} targetX={250} targetY={200} sourcePosition="bottom" targetPosition="top" data={{status,kind,fresh,demoMotion,routing:'curve',eventId:'recorded-event',agentId:'recorded-actor'}} /></svg>);
    expect((output.match(/class="son-motion-particle/g)||[]).length).toBe(count);
    if(count) expect(output).toContain(`data-motion-source="${demoMotion?'synthetic-demo':'recorded-execution'}"`);
    expect(output).not.toContain('NaN');
  });
});


describe('decorative ambient flow', () => {
  it('covers each visible structural layer pair with bounded particles and leaves evidence untouched', () => {
    const graph = buildNetwork({modules, agents:[{id:'a',name:'Agent',status:'observed',workspaces:['factory'],moduleIds:['factory-0'],gatewayId:'g'}], gateways:[{id:'g',name:'Gateway'}], expanded:new Set(['factory'])});
    const original = JSON.stringify(graph);
    const edges = presentNetworkEdges(graph.edges, false);
    const ambient = edges.filter(edge => edge.data.ambientMotion);
    const pairs = list => new Set(list.map(edge => `${edge.data.sourceLayer}:${edge.data.targetLayer}`));
    expect(pairs(ambient)).toEqual(pairs(graph.edges.filter(edge => edge.data.kind === 'dependency')));
    expect(ambient.length).toBeGreaterThan(1);
    expect(ambient.length).toBeLessThanOrEqual(ambientEdgeBudget());
    expect(ambient.every(edge => edge.data.kind === 'dependency' && !edge.data.demoMotion)).toBe(true);
    expect(JSON.stringify(graph)).toBe(original);
    expect(presentNetworkEdges(graph.edges, false)).toEqual(edges);
    const visible = ['platform', 'workspace:factory'];
    expect(presentNetworkEdges(graph.edges, false, null, visible).filter(edge => edge.data.ambientMotion).every(edge => visible.includes(edge.source) || visible.includes(edge.target))).toBe(true);
  });
  it('gives attributed running and fresh completion priority on the same directed relationship', () => {
    const structural = {id:'s',source:'a',target:'b',data:{kind:'dependency'}};
    const execution = {id:'e',source:'a',target:'b',data:{kind:'execution',eventId:'event',agentId:'actor',status:'running'}};
    expect(presentNetworkEdges([structural, execution], false)[0].data.ambientMotion).toBe(false);
    expect(presentNetworkEdges([structural, {...execution,data:{...execution.data,status:'completed',fresh:true}}],false)[0].data.ambientMotion).toBe(false);
    expect(presentNetworkEdges([structural, {...execution,data:{...execution.data,agentId:null}}],false)[0].data.ambientMotion).toBe(true);
    expect(presentNetworkEdges([structural, {...execution,data:{...execution.data,status:'pending'}}],false)[0].data.ambientMotion).toBe(true);
  });
  it('renders a small ambient particle on the routed structural path, never on authorization or as execution', () => {
    const render = kind => renderToStaticMarkup(<svg><NetworkEdge id="ambient" sourceX={0} sourceY={0} targetX={250} targetY={200} sourcePosition="bottom" targetPosition="top" data={{kind,ambientMotion:true,routePoints:[{x:0,y:0},{x:0,y:100},{x:250,y:100},{x:250,y:200}]}}/></svg>);
    const output = render('dependency');
    expect((output.match(/class="son-motion-particle/g)||[])).toHaveLength(3);
    expect(output).toContain('data-motion-source="ambient-network"');
    expect(output).toContain('r="1.5"');
    expect(output).toContain('offset-path:path(');
    expect(output).not.toContain('recorded-execution');
    expect(render('authorization')).not.toContain('son-motion-particle');
  });
});


it('scales the ambient budget to viewport area while reserving every eligible layer pair and focus ancestry', () => {
  const pairs = [[0,1],[1,2],[2,2],[0,4],[3,4]];
  const edges = pairs.flatMap(([sourceLayer,targetLayer],group) => Array.from({length:25},(_,i) => ({id:`${group}-${i}`,source:`s${group}`,target:`t${i}`,data:{kind:'dependency',sourceLayer,targetLayer}})));
  const selectedId = 't24', focus = {active:true,nodeIds:new Set(),edgeIds:new Set(['0-24','1-24','2-24'])};
  const narrow = {width:383,height:630}, desktop = {width:1464,height:900};
  const moving = size => presentNetworkEdges(edges,false,selectedId,[],focus,size).filter(edge => edge.data.ambientMotion);
  expect(moving(narrow)).toHaveLength(ambientEdgeBudget(narrow));
  expect(moving(desktop).length).toBeGreaterThan(12);
  expect(moving(desktop)).toHaveLength(ambientEdgeBudget(desktop));
  expect(ambientEdgeBudget({width:10000,height:10000})).toBe(48);
  expect(ambientEdgeBudget({width:200,height:200})).toBe(8);
  expect(new Set(moving(narrow).map(e => `${e.data.sourceLayer}:${e.data.targetLayer}`)).size).toBe(pairs.length);
  expect(moving(narrow).filter(e => focus.edgeIds.has(e.id))).toHaveLength(3);
});
