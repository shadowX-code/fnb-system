import { supabase } from '../../../lib/supabase';

async function command(action, outletId, body = {}) {
 const { data, error } = await supabase.functions.invoke(`google-business/${action}`, { body: { outletId, ...body } });
 if (error) {
  let message = 'Google Reviews request could not be completed.';
  let status;
  if (error.context instanceof Response) try { status=error.context.status; message = (await error.context.json()).error || message; } catch { /* Keep safe fallback. */ }
  const cause=new Error(message); cause.uncertain=!status || status>=500; throw cause;
 }
 return data;
}
export const googleBusinessService = {
 detail: (outlet, review, basis) => command('review',outlet,{review,generation:basis.generation,revision:basis.mapping.revision}),
 reply: (outlet, intent) => command('reply',outlet,{...intent,confirmed:true}),
 replyStatus: (outlet,id) => command('reply_status',outlet,{id}),
 context: outlet => command('context', outlet),
 authorize: outlet => command('authorize', outlet),
 disconnect: (outlet,generation) => command('disconnect',outlet,{generation}),
 revoke: (outlet,generation) => command('revoke',outlet,{generation,confirmed:true,scopeAcknowledged:'google_project'}),
 discover: outlet => command('discover', outlet),
 sync: outlet => command('sync', outlet),
 map: (outlet, location, context) => command('map', outlet, { location, generation: context.generation, revision: context.mapping?.revision, confirmMapping: true }),
};
