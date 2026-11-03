import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { networkDemoAllowed } from './networkEnvironment.js';

afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();localStorage.removeItem('visualDemo');history.replaceState(null,'','/');});

it.each([
  ['https://ujkzdaaadnvcfayuldmh.supabase.co',false,true],
  ['https://oyfobxdoyfuzsodogpgs.supabase.co',false,false],
  ['https://oyfobxdoyfuzsodogpgs.supabase.co',true,false],
  ['http://localhost',true,true],
  ['http://127.0.0.1:54321',true,true],
  ['http://localhost',false,false],
  ['https://unknown.supabase.co',true,false],
  ['',false,false],
])('allows synthetic motion for data identity %s with development=%s only when explicitly non-Production',(dataUrl,development,expected)=>{
  expect(networkDemoAllowed({dataUrl,development})).toBe(expected);
});

it('rejects URL/storage/requested-state and renderer flag bypasses in Production; keeps ambient separate from attributed execution particles',async()=>{
  vi.stubEnv('VITE_SUPABASE_URL','https://oyfobxdoyfuzsodogpgs.supabase.co');
  vi.stubEnv('DEV',false);vi.resetModules();
  history.replaceState({visualDemo:true},'','/system/operations-network?demo=true&visualDemo=1&synthetic=true');
  localStorage.setItem('visualDemo','true');
  const {NETWORK_DEMO_ALLOWED}=await import('./networkEnvironment.js');
  const {presentNetworkEdges}=await import('./networkPresentation.js');
  const {NetworkEdge}=await import('./NetworkGraph.jsx');
  expect(NETWORK_DEMO_ALLOWED).toBe(false);
  const structural={id:'structural',source:'p',target:'w',data:{kind:'dependency',demoMotion:true,status:'running'}};
  const presented = presentNetworkEdges([structural],true)[0];
  expect(presented.data.demoMotion).toBe(false);
  expect(presented.data.ambientMotion).toBe(true);
  const render=data=>renderToStaticMarkup(<svg><NetworkEdge id="edge" sourceX={0} sourceY={0} targetX={200} targetY={100} sourcePosition="bottom" targetPosition="top" data={data}/></svg>);
  expect(render(presented.data)).toContain('data-motion-source="ambient-network"');
  expect(render(presented.data)).not.toContain('synthetic-demo');
  for(const kind of ['dependency','authorization','execution']) {
    expect(render({kind,status:'running',fresh:true,demoMotion:true})).not.toContain('son-motion-particle');
  }
  const attributed={kind:'execution',eventId:'recorded-event',agentId:'recorded-actor',status:'running',demoMotion:true};
  const running=render(attributed);
  expect((running.match(/class="son-motion-particle/g)||[]).length).toBe(3);
  expect(running).toContain('data-motion-source="recorded-execution"');
  expect(running).not.toContain('synthetic-demo');
  expect(render({...attributed,status:'pending'})).not.toContain('son-motion-particle');
  expect(render({...attributed,status:'completed',fresh:true})).toContain('data-motion-source="recorded-execution"');
});
