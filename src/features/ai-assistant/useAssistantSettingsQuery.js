import {useCallback, useEffect, useRef, useState} from 'react';

const refreshInterval = 15000;
const accessErrors = new Set(['authentication_required','admin_required','settings_view_required']);

// Both settings reads share request ownership, foreground revalidation and retry.
export function useAssistantSettingsQuery(key, read, {paused = false, pollUntil} = {}) {
 const [result, setResult] = useState(null);
 const request = useRef(null);
 const lastStarted = useRef(0);
 const current = result?.key === key ? result : null;

 const refresh = useCallback(() => {
  if (request.current?.key === key) return request.current.promise;
  const controller = new AbortController();
  const operation = {key, controller};
  lastStarted.current = Date.now();
  request.current = operation;
  setResult(previous => ({key, data: previous?.key === key ? previous.data : null, loading: true, error: ''}));
  operation.promise = Promise.resolve().then(() => {
   controller.signal.throwIfAborted();
   return read(controller.signal);
  }).then(data => {
   if (request.current !== operation) return null;
   setResult({key, data, loading: false, error: ''});
   return data;
  }).catch(error => {
   if (request.current === operation) setResult(previous => ({
    ...previous, data: accessErrors.has(error.code) ? null : previous.data,
    loading: false, error: error.message || 'Unable to load Assistant settings.',
   }));
   return null;
  }).finally(() => {
   if (request.current === operation) request.current = null;
  });
  return operation.promise;
 }, [key, read]);

 useEffect(() => {
  void refresh();
  return () => {
   const operation = request.current;
   request.current = null;
   operation?.controller.abort();
  };
 }, [refresh]);

 const deadline = pollUntil?.(current?.data) ?? 0;
 useEffect(() => {
  if (paused || current?.error) return;
  let timer;
  function checkForeground() {
   clearTimeout(timer);
   if (document.hidden) return;
   if (Date.now() - lastStarted.current >= refreshInterval) void refresh();
   else schedule();
  }
  function schedule() {
   if (!document.hidden && Date.now() <= deadline && !current?.loading) {
    timer = setTimeout(checkForeground, Math.max(1, refreshInterval - (Date.now() - lastStarted.current)));
   }
  }
  schedule();
  window.addEventListener('focus', checkForeground);
  document.addEventListener('visibilitychange', checkForeground);
  return () => {
   clearTimeout(timer);
   window.removeEventListener('focus', checkForeground);
   document.removeEventListener('visibilitychange', checkForeground);
  };
 }, [current?.loading, current?.error, deadline, paused, refresh]);

 return {data: current?.data, error: current?.error, loading: current?.loading ?? true, refresh};
}
