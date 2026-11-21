import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {useAssistantSettingsQuery} from './useAssistantSettingsQuery.js';

afterEach(() => {
 cleanup();
 vi.useRealTimers();
 vi.restoreAllMocks();
});

it('shares in-flight foreground reads, polls only through the active observation window, and skips hidden tabs',async()=>{
 vi.useFakeTimers();
 let hidden=false;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const cutoff=Date.now()+16000;
 const read=vi.fn(async()=>({cutoff}));
 const {result}=renderHook(()=>useAssistantSettingsQuery('voice',read,{pollUntil:data=>data?.cutoff}));
 await act(async()=>{});
 expect(read).toHaveBeenCalledTimes(1);
 hidden=true;
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 await act(()=>vi.advanceTimersByTimeAsync(15000));
 expect(read).toHaveBeenCalledTimes(1);
 hidden=false;
 await act(async()=>{
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
 });
 expect(read).toHaveBeenCalledTimes(2);
 expect(result.current.data.cutoff).toBe(cutoff);
 await act(()=>vi.advanceTimersByTimeAsync(90000));
 expect(read).toHaveBeenCalledTimes(3);
});

it('aborts stale filter requests, preserves the latest results and retries only on demand after a load failure',async()=>{
 const releases={};
 const readMonth=vi.fn(signal=>new Promise(resolve=>{releases.month={signal,resolve};}));
 const readWeek=vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({period:'week'});
 const {result,rerender}=renderHook(({period,read})=>useAssistantSettingsQuery(period,read),{
  initialProps:{period:'month',read:readMonth},
 });
 await act(async()=>{});
 rerender({period:'week',read:readWeek});
 await act(async()=>{releases.month.resolve({period:'month'});});
 expect(releases.month.signal.aborted).toBe(true);
 expect(result.current.error).toBe('Offline');
 expect(result.current.data).toBeNull();
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(readWeek).toHaveBeenCalledTimes(1);
 await act(async()=>{await result.current.refresh();});
 expect(result.current.data).toEqual({period:'week'});
});
