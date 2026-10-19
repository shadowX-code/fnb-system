export const INBOX_STATUSES = [
  {value:'open',label:'Open',description:'Needs attention · staff handling or unresolved work.'},
  {value:'pending',label:'Pending',description:'Waiting for the customer · no unfinished staff work.'},
  {value:'resolved',label:'Resolved',description:'Completed · a new customer message reopens the conversation.'},
];
export const inboxStatusDescription = value => INBOX_STATUSES.find(s=>s.value===value)?.description || '';
export const inboxStatusOptions = INBOX_STATUSES.map(s=>({value:s.value,label:`${s.label} · ${s.value==='open'?'Needs attention':s.value==='pending'?'Waiting for customer':'Completed'}`}));
export function inboxStatusTabs(counts) {
  return [{value:'',label:'All'},...INBOX_STATUSES].map(s=>({value:s.value,label:s.label+(Number.isInteger(counts?.[s.value||'all'])?` ${counts[s.value||'all']}`:'')}));
}
