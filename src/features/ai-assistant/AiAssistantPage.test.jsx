import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import AiAssistantPage from './AiAssistantPage.jsx';
import { assistantStagingAllowed } from './assistantEnvironment.js';
import { accessibleNetworkModules } from '../operations-network/networkModel.js';
import { moduleRegistry } from '../../../config/modules.ts';
import { getAdminRouteDefinition } from '../../app/routeOwnership.js';
vi.mock('./assistantEnvironment.js', async importOriginal => ({...await importOriginal(), ASSISTANT_STAGING_ALLOWED:true}));
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();vi.restoreAllMocks();});

it('owns one Admin system entry and enables only the canonical Staging data identity',()=>{
  expect(moduleRegistry.find(m=>m.id==='ai_assistant')).toMatchObject({route:'/system/ai-assistant',sidebar:false,permissions:{}});
  expect(getAdminRouteDefinition('ai_assistant').ownership.domain).toBe('system');
  expect(accessibleNetworkModules([{id:'ai_assistant',permission:''}],{hasPermission:()=>true}).some(m=>m.id==='ai_assistant')).toBe(false);
  expect(assistantStagingAllowed('https://ujkzdaaadnvcfayuldmh.supabase.co')).toBe(true);
  for(const url of [undefined,'https://oyfobxdoyfuzsodogpgs.supabase.co','https://ujkzdaaadnvcfayuldmh.supabase.co?assistant=true'])expect(assistantStagingAllowed(url)).toBe(false);
});
it('uses an opaque sandbox without credentials or browser permissions',()=>{
  const back=vi.fn();render(<AiAssistantPage ui={{returnFromNetwork:back}}/>);
  const frame=screen.getByTitle('FeedX AI Assistant — isolated Jarvis conversation HUD');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-downloads');
  expect(frame.getAttribute('allow')).toContain("microphone 'none'");
  expect(frame.getAttribute('src')).toBe('/open-source/jarvis/index.html');
  fireEvent.click(screen.getByRole('button',{name:'Back to workspace'}));expect(back).toHaveBeenCalledOnce();
  expect(screen.getByRole('link',{name:'HUD source & license'}).getAttribute('href')).toBe('/open-source/jarvis/source.zip');
});
it('keeps conversation requests inert, bounded, safely rendered and separate from AI answers',()=>{
  const source=readFileSync('public/open-source/jarvis/web.js','utf8');
  expect(source).not.toMatch(/new WebSocket|fetch\(|getUserMedia|127\.0\.0\.1|localhost/);
  document.body.innerHTML=readFileSync('public/open-source/jarvis/index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'')+'<button id="demoBack"></button>';
  const reducedMotion={matches:false,addEventListener:vi.fn()};
  vi.stubGlobal('matchMedia',query=>query.includes('reduced-motion')?reducedMotion:{matches:false,addEventListener:vi.fn()});
  const $=s=>document.querySelector(s), input=$('#cmd');
  const setState=vi.fn(s=>{document.body.dataset.state=s;});
  const frozenRender=vi.fn();vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.stubGlobal('requestAnimationFrame',cb=>{cb();return 1;});
  new Function('$','input','setState','wakeUI','applySchedule','STATE_LABEL','sysLive','tripLive','wxLive','SCHED','STATES','composer',source)($,input,setState,vi.fn(),vi.fn(),{},false,false,false,[],{idle:{}},{render:frozenRender});
  input.value='<img src=x onerror=alert(1)> inventory';fireEvent.keyDown(input,{key:'Enter'});
  expect($('#webMessages').textContent).toContain('<img src=x');expect($('#webMessages img')).toBe(null);
  expect($('#webNotice').textContent).toContain('no AI answer was generated');expect(setState).not.toHaveBeenCalledWith('thinking');
  fireEvent.click($('#mic'));expect($('#webNotice').textContent).toContain('No microphone was opened');
  fireEvent.click($('#webNew'));expect($('#webMessages').textContent).not.toContain('inventory');
  expect($('#webHistory')).toBeNull();
  reducedMotion.matches=true;reducedMotion.addEventListener.mock.calls[0][1]();expect(window.FEEDX_VISUAL_PAUSED).toBe(true);fireEvent(window,new Event('resize'));expect(frozenRender).toHaveBeenCalledOnce();
  fireEvent.click($('#webStop'));expect($('#webNotice').textContent).toContain('No AI generation');
  fireEvent(window,new MessageEvent('message',{source:window.parent,origin:'https://fnb-system-staging.vercel.app',data:{protocol:'feedx.assistant.text.v1',type:'reset'}}));
  expect($('#webMessages').textContent).not.toContain('inventory');expect($('#webOlder').hidden).toBe(true);expect(input.value).toBe('');
  const post=(type, payload={})=>fireEvent(window,new MessageEvent('message',{
    source:window.parent,origin:'https://fnb-system-staging.vercel.app',
    data:{protocol:'feedx.assistant.text.v1',type,...payload},
  }));
  const completed={state:'completed',prompt:'Stock check',reply:'Read complete',voice:true};
  post('history',{session_id:'saved',turns:[{...completed,request_id:'first'},{...completed,request_id:'second'}]});
  const rows=()=>[...document.querySelectorAll('#webActivity > li')];
  expect(rows().map(row=>row.dataset.stage)).toEqual(['complete','complete']);
  const voice=(phase, at, operation)=>post('voice_activity',{session_id:'saved',turn_id:'live',phase,at,operation});
  voice('processing',1000);
  const live=rows()[0];
  voice('executing',1100,1);
  voice('complete',1200,1);
  voice('executing',1300,2);
  voice('denied',1400,2);
  voice('speaking',1500);
  post('voice_turn',{session_id:'saved',turn:{request_id:'live',prompt:'Follow up',voice:true,state:'cancelled',error_code:'voice_unfinished',tool_state:'failed'}});
  expect(live.dataset.stage).toBe('speaking');
  expect($('#webMessages [data-outcome]')).toBeNull();
  voice('complete',2100);
  voice('processing',2200);
  expect(rows()).toHaveLength(3);
  expect(rows()[0]).toBe(live);
  expect(live.textContent).toContain('Completed · 1.1 s');
  expect([...live.querySelectorAll('ul > li')].map(row=>row.textContent)).toEqual([
    'Factory Finished Goods · Completed · 0.1 s',
    'Factory Finished Goods · Access denied · 0.1 s',
  ]);
  input.blur();
  post('view',{immersive:true});
  post('voice_telemetry',{message:'Connection interrupted',resume:true,active:true,report:{metrics:['Audio tokens: 20 in / 30 out'],events:['42 ms · connected']}});
  expect($('#webVoiceAvailability').textContent).toBe('Connection interrupted');
  expect($('#webVoiceResume').hidden).toBe(false);
  expect($('#webVoiceRefresh').hidden).toBe(true);
  expect($('#webVoiceDiagnostics').closest('details').open).toBe(false);
  expect($('#webVoiceDiagnostics ol').textContent).toContain('42 ms · connected');
  const toggle=$('#webComposeToggle');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(input);
  input.value='Keep this\nmultiline draft';
  fireEvent.keyDown(input,{key:'Escape'});
  expect(document.activeElement).toBe(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(input.value).toBe('Keep this\nmultiline draft');
  expect($('#webPause')).toBeNull();
});
it('distributes editable GPL source and denies network connections for this static program',()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));const boundary=config.routes.find(r=>r.src==='/open-source/jarvis/(.*)');
  expect(boundary.headers['Access-Control-Allow-Origin']).toBe('*');expect(boundary.headers['Content-Security-Policy']).toContain('frame-ancestors https://fnb-system-staging.vercel.app');expect(boundary.headers['Content-Security-Policy']).toContain("connect-src 'none'");
  expect(readFileSync('public/open-source/jarvis/LICENSE.txt','utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
  expect(readFileSync('public/open-source/jarvis/source.zip').length).toBeGreaterThan(10000);
  const page=readFileSync('src/features/ai-assistant/AiAssistantPage.jsx','utf8');expect(page).not.toMatch(/from.*open-source|postMessage/);
});

it('switches Assistant view in-window without requesting native fullscreen or replacing the Core',()=>{
 const native=vi.fn();Element.prototype.requestFullscreen=native;
 render(<AiAssistantPage/>);
 const core=screen.getByTitle('FeedX AI Assistant — isolated Jarvis conversation HUD');
 fireEvent.click(screen.getByRole('button',{name:'Immersive view'}));
 expect(screen.getByRole('button',{name:'Standard view'})).toBeTruthy();
 expect(screen.getByTitle('FeedX AI Assistant — isolated Jarvis conversation HUD')).toBe(core);
 expect(native).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Standard view'}));
 expect(screen.getByTitle('FeedX AI Assistant — isolated Jarvis conversation HUD')).toBe(core);
 delete Element.prototype.requestFullscreen;
});
