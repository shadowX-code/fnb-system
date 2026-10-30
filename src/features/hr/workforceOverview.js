export const companyName = entity => entity.display_name || entity.legal_company_name || entity.name || 'Company name unavailable';
export const classificationLabel = value => value ? String(value).replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : 'Unspecified';
const classification = value => typeof value === 'string' && value.trim() ? value.trim() : '';
export const companyKey = employee => employee.legal_entity_id || 'unassigned';

export function workforceOverview(records, company = 'all') {
  const employees = [...new Map(records.map(row=>[row.id,row])).values()]
    .filter(row=>company==='all' || companyKey(row)===company);
  const distribution = field => {
    const counts = new Map();
    for (const row of employees) { const key=classification(row[field]); counts.set(key,(counts.get(key)||0)+1); }
    return [...counts].map(([key,count])=>({key,label:classificationLabel(key),count,percentage:employees.length?count/employees.length*100:0}))
      .sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label));
  };
  const groups = new Map();
  for (const row of employees) {
    const id=companyKey(row), group=groups.get(id)||{id,total:0,active:0,types:new Map()};
    group.total++; if (row.employment_status==='active')group.active++;
    const type=classification(row.employment_type);group.types.set(type,(group.types.get(type)||0)+1);
    groups.set(id,group);
  }
  return {total:employees.length,active:employees.filter(row=>row.employment_status==='active').length,
    companyCount:[...groups.keys()].filter(id=>id!=='unassigned').length,
    types:distribution('employment_type'),statuses:distribution('employment_status'),
    companies:[...groups.values()].map(group=>({...group,types:[...group.types].map(([key,count])=>({label:classificationLabel(key),count}))}))};
}

export function payrollOverview(periods, company, month) {
  return periods.filter(period=>company==='all' || period.legal_entity_id===company).flatMap(period=>{
    const runs=[...(period.runs||[])].sort((a,b)=>Number(b.revision)-Number(a.revision));
    const run=runs.find(row=>['draft','review_required','ready'].includes(row.status)) || runs[0];
    if(!run || (!['draft','review_required','ready'].includes(run.status) && period.period_start?.slice(0,7)!==month))return [];
    return [{...period,run}];
  }).sort((a,b)=>Number(b.period_start?.slice(0,7)===month)-Number(a.period_start?.slice(0,7)===month)
    || Number(a.period_start>month+'-31')-Number(b.period_start>month+'-31')
    || (a.period_start>month+'-31' ? a.period_start.localeCompare(b.period_start) : b.period_start.localeCompare(a.period_start)));
}
