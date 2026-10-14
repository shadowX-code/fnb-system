import { supabase } from '../../../lib/supabase';

async function command(action, outletId, body = {}) {
 const { data, error } = await supabase.functions.invoke(`google-business/${action}`, { body: { outletId, ...body } });
 if (error) {
  let message = 'Google Reviews request could not be completed.';
  if (error.context instanceof Response) try { message = (await error.context.json()).error || message; } catch { /* Keep safe fallback. */ }
  throw new Error(message);
 }
 return data;
}
export const googleBusinessService = {
 context: outlet => command('context', outlet),
 authorize: outlet => command('authorize', outlet),
 disconnect: outlet => command('disconnect', outlet),
 discover: outlet => command('discover', outlet),
 sync: outlet => command('sync', outlet),
 map: (outlet, location, context) => command('map', outlet, { location, generation: context.generation, revision: context.mapping?.revision, confirmMapping: true }),
};
