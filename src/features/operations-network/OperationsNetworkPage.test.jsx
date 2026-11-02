import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ flow: { fitView: vi.fn() }, agents: [], modules: [0,1].map(index=>({id:`factory-test-${index}`,label:`Operation ${index}`,workspace:'factory',section:'Production'})) }));
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({children})=>children, useReactFlow:()=>mocks.flow,
  ReactFlow:({nodes,onNodeClick})=><div>{nodes.map(node=><button key={node.id} onClick={event=>onNodeClick(event,node)}>{node.data.label}</button>)}</div>,
  Controls:()=>null, Handle:()=>null, BaseEdge:()=>null, Position:{Top:'top',Bottom:'bottom',Left:'left',Right:'right'}, getBezierPath:()=>['M0,0 L1,1'],
}));
vi.mock('./networkModel.js',async importOriginal=>({...await importOriginal(),accessibleNetworkModules:()=>mocks.modules}));
vi.mock('./useNetworkEvidence.js',()=>({default:()=>({active:true,loading:false,agents:mocks.agents,events:[],integrations:[],sources:[],companies:[],refresh:()=>{}})}));
vi.mock('./useNetworkFullscreen.js',()=>({default:()=>({fullscreen:false,notice:'',toggleFullscreen:()=>{}})}));
import OperationsNetworkPage from './OperationsNetworkPage.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();mocks.flow.fitView.mockClear();mocks.agents=[];});
it('focuses the operation bay when expanding from a selected workspace detail',async()=>{
  vi.stubGlobal('requestAnimationFrame',callback=>{callback();return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
  const auth={hasPermission:()=>false,user:{id:'test'},permissions:[],profile:{}};
  render(<OperationsNetworkPage auth={auth} store={{outlets:[]}} ui={{networkRoutes:[],networkWorkspace:'factory',returnFromNetwork:()=>{},navigate:()=>{}}}/>);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Factory',exact:true})));
  expect(screen.getByRole('region',{name:'Factory details'})).toBeTruthy();
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Expand operations',exact:true})));
  expect(mocks.flow.fitView.mock.calls.at(-1)[0].nodes.map(node=>node.id)).toEqual(['factory-test-0','factory-test-1']);
});

it('refits the primary hierarchy when asynchronous evidence adds individual nodes',async()=>{
  vi.stubGlobal('requestAnimationFrame',callback=>{callback();return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
  const props={auth:{hasPermission:()=>false,user:{id:'test'},permissions:[],profile:{}},store:{outlets:[]},ui:{networkRoutes:[],networkWorkspace:'factory',returnFromNetwork:()=>{},navigate:()=>{}}};
  const view=render(<OperationsNetworkPage {...props}/>);
  mocks.agents=[{id:'a',name:'Recorded agent',status:'observed',workspaces:['factory'],moduleIds:['factory-test-0']}];
  await act(async()=>view.rerender(<OperationsNetworkPage {...props}/>));
  expect(mocks.flow.fitView.mock.calls.at(-1)[0].nodes.map(node=>node.id)).toContain('gateway:a');
});

it('keeps active search/reset, time selection and polling status distinct from synthetic Demo',async()=>{
  render(<OperationsNetworkPage auth={{hasPermission:()=>false,user:{id:'test'},permissions:[],profile:{}}} store={{outlets:[]}} ui={{networkRoutes:[],networkWorkspace:'factory',returnFromNetwork:()=>{},navigate:()=>{}}}/>);
  fireEvent.click(screen.getByText('Filters & search'));
  fireEvent.change(screen.getByRole('searchbox',{name:'Search nodes'}),{target:{value:'Operation 1'}});
  expect(screen.getByLabelText('Active filters').textContent).toContain('Operation 1');
  fireEvent.click(screen.getByRole('button',{name:'Reset filters'}));
  expect(screen.getByRole('searchbox',{name:'Search nodes'}).value).toBe('');
  expect(screen.queryByLabelText('Active filters')).toBeNull();
  fireEvent.click(screen.getByRole('tab',{name:'24H',exact:true}));
  expect(screen.getByText('Snapshot · manual refresh')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Visual Demo',exact:true}));
  expect(screen.getByText('Synthetic motion · recorded evidence unchanged')).toBeTruthy();
  expect(screen.getByText('Snapshot · manual refresh')).toBeTruthy();
});
it('moves complete coverage information and layer explanations into shared drawers',()=>{
  render(<OperationsNetworkPage auth={{hasPermission:()=>false,user:{id:'test'},permissions:[],profile:{}}} store={{outlets:[]}} ui={{networkRoutes:[],networkWorkspace:'factory',returnFromNetwork:()=>{},navigate:()=>{}}}/>);
  expect(screen.queryByText(/System health & throughput/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Data Coverage',exact:true}));
  expect(screen.getByRole('dialog',{name:'Data Coverage'})).toBeTruthy();
  expect(screen.getByText(/System health & throughput: unavailable/)).toBeTruthy();
  expect(screen.getByText(/Agent telemetry requires existing AI Integrations view authority/)).toBeTruthy();
  expect(screen.getByText(/Connections show the latest saved snapshot/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Close drawer',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Layers',exact:true}));
  expect(screen.getByRole('dialog',{name:'Network layers'})).toBeTruthy();
  expect(screen.getByText('L5')).toBeTruthy();
});
