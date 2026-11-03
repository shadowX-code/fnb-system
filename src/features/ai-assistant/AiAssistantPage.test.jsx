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
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();});

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
  fireEvent.click(screen.getByText('Back to workspace'));expect(back).toHaveBeenCalledOnce();
  expect(screen.getByText('HUD source & license').getAttribute('href')).toBe('/open-source/jarvis/source.zip');
});
it('keeps conversation requests inert, bounded, safely rendered and separate from AI answers',()=>{
  const source=readFileSync('public/open-source/jarvis/web.js','utf8');
  expect(source).not.toMatch(/new WebSocket|fetch\(|getUserMedia|127\.0\.0\.1|localhost/);
  document.body.innerHTML=readFileSync('public/open-source/jarvis/index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'')+'<button id="demoBack"></button>';
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn()}));
  const $=s=>document.querySelector(s), input=$('#cmd');
  const setState=vi.fn(s=>{document.body.dataset.state=s;});
  new Function('$','input','setState','wakeUI','applySchedule','STATE_LABEL','sysLive','tripLive','wxLive','SCHED','STATES',source)($,input,setState,vi.fn(),vi.fn(),{},false,false,false,[],{idle:{}});
  input.value='<img src=x onerror=alert(1)> inventory';fireEvent.keyDown(input,{key:'Enter'});
  expect($('#webMessages').textContent).toContain('<img src=x');expect($('#webMessages img')).toBe(null);
  expect($('#webNotice').textContent).toContain('no AI answer was generated');expect(setState).not.toHaveBeenCalledWith('thinking');
  fireEvent.click($('#mic'));expect($('#webNotice').textContent).toContain('No microphone was opened');
  fireEvent.click($('#webNew'));expect($('#webMessages').textContent).not.toContain('inventory');
  const history=$('#webHistory');history.value=history.options[0].value;fireEvent.change(history);
  expect($('#webMessages').textContent).toContain('inventory');
  fireEvent.click($('#webPause'));expect(window.FEEDX_VISUAL_PAUSED).toBe(true);
  fireEvent.click($('#webStop'));expect($('#webNotice').textContent).toContain('No AI generation');
});
it('distributes editable GPL source and denies network connections for this static program',()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));const boundary=config.routes.find(r=>r.src==='/open-source/jarvis/(.*)');
  expect(boundary.headers['Access-Control-Allow-Origin']).toBe('*');expect(boundary.headers['Content-Security-Policy']).toContain('frame-ancestors https://fnb-system-staging.vercel.app');expect(boundary.headers['Content-Security-Policy']).toContain("connect-src 'none'");
  expect(readFileSync('public/open-source/jarvis/LICENSE.txt','utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
  expect(readFileSync('public/open-source/jarvis/source.zip').length).toBeGreaterThan(10000);
  const page=readFileSync('src/features/ai-assistant/AiAssistantPage.jsx','utf8');expect(page).not.toMatch(/from.*open-source|postMessage/);
});
