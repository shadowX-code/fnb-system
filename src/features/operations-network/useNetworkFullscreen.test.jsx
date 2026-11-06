import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useNetworkFullscreen from './useNetworkFullscreen.js';
afterEach(cleanup);
it('provides window fullscreen when native fullscreen is rejected and restores background access on Escape', async () => {
  const host = document.createElement('div'), background = document.createElement('header'), root = document.createElement('section');
  host.append(background, root); document.body.append(host);
  root.requestFullscreen = vi.fn().mockRejectedValue(new Error('Document not focused'));
  const ref = { current: root };
  const previousOverflow = document.body.style.overflow;
  const { result, unmount } = renderHook(() => useNetworkFullscreen(ref));
  await act(async () => result.current.toggleFullscreen());
  expect(result.current.fullscreen).toBe(true);
  expect(result.current.notice).toContain('expanded to fill this window');
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(result.current.fullscreen).toBe(false);
  expect(background.inert).not.toBe(true);
  expect(document.body.style.overflow).toBe(previousOverflow);
  unmount(); host.remove();
});

it('supports in-window Assistant mode and leaves nested modal Escape to its dialog',async()=>{
 const root=document.createElement('section'),dialog=document.createElement('aside');dialog.setAttribute('role','dialog');root.append(dialog);document.body.append(root);
 root.requestFullscreen=vi.fn();
 const {result,unmount}=renderHook(()=>useNetworkFullscreen({current:root},{native:false}));
 await act(async()=>result.current.toggleFullscreen());
 expect(result.current.fullscreen).toBe(true);expect(root.requestFullscreen).not.toHaveBeenCalled();
 act(()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(result.current.fullscreen).toBe(true);
 act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(result.current.fullscreen).toBe(false);unmount();root.remove();
});
