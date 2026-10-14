export const customerName = c => c.display_name?.trim() || c.phone_e164 || 'Unnamed Customer';
export const customerEdit = c => ({customer_id:c.id,name:c.display_name||'',phone:c.phone_e164,email:c.email||'',gender:c.gender||'',birthday:c.birthday||'',language:c.language,tags:c.tags,outlet_id:c.outlet_id||'',edit:true,revision:c.revision,snapshot:c.snapshot});
export const CUSTOMER_COLUMNS = [['name','Name'],['phone_e164','Phone'],['email','Email'],['gender','Gender'],['birthday','Birthday'],['total_visit','Total Visit'],['avg_spent','Avg Spent'],['total_spent','Total Spent'],['last_visit','Last Visit'],['member_since','Member Since'],['tags','Tags'],['brand_name','Brand'],['outlet','Outlet'],['consent','WhatsApp Consent'],['activity','Last Activity'],['actions','Actions']];
export const DEFAULT_CUSTOMER_COLUMNS = ['name','phone_e164','total_visit','total_spent','last_visit','tags','outlet','consent','actions'];
const preferenceKey = user => `marketing.customers.columns.${user || 'staff'}`;
const validColumns = keys => [...new Set(['name', ...keys.filter(key => CUSTOMER_COLUMNS.some(([allowed]) => allowed === key))])];
export function preferredCustomerColumns(user) {
 try {
  const current = JSON.parse(localStorage.getItem(`${preferenceKey(user)}.v2`));
  if (Array.isArray(current)) return validColumns(current);
  const legacy = JSON.parse(localStorage.getItem(preferenceKey(user)));
  // These operational columns were always visible before customization supported them.
  if (Array.isArray(legacy)) return validColumns([...legacy, 'consent', 'activity', 'actions']);
 } catch {}
 return [...DEFAULT_CUSTOMER_COLUMNS];
}
export function saveCustomerColumns(user, keys) {
 try { localStorage.setItem(`${preferenceKey(user)}.v2`, JSON.stringify(validColumns(keys))); } catch {}
}
export function customerDate(value){return value?new Date(value.slice(0,10)+'T00:00:00+08:00').toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric'}):'—';}
export function posMetric(c,key){const value=c.pos_snapshot?.metrics?.[key];if(value===undefined||value===null)return '—';return ['avg_spent','total_spent'].includes(key)?new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(value):['last_visit','member_since'].includes(key)?customerDate(value):String(value);}
