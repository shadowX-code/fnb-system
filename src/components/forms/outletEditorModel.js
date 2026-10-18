import {WEEKDAYS} from '../../services/outletServiceProfileService.js';

export const OUTLET_SECTIONS = [
  ['general', 'General'], ['contact', 'Contact & Hours'],
  ['policies', 'Service Policies'], ['attendance', 'Attendance & GPS'],
];
export const POLICY_LABELS = ['Dine-in', 'Takeaway', 'Delivery', 'Reservations'];

// The existing source contract stores policies as text. Keep unmatched legacy text verbatim.
export function readServicePolicies(text = '') {
  const policies = {}, remaining = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^(Dine-in|Takeaway|Delivery|Reservations): (Available|Not offered)(?: — (.*))?$/);
    if (match && !policies[match[1]]) policies[match[1]] = {status: match[2], description: match[3] || ''};
    else remaining.push(line);
  }
  return {policies, additional: remaining.join('\n')};
}
export function writeServicePolicies({policies, additional}) {
  return [...POLICY_LABELS.filter(label => policies[label]?.status).map(label => {
    const {status, description} = policies[label];
    return `${label}: ${status}${description ? ` — ${description}` : ''}`;
  }), ...(additional ? [additional] : [])].join('\n');
}

export function validateOutletMaster(value) {
  if (!value.name?.trim()) return {section: 'general', field: 'name', message: 'Enter an Outlet name.'};
  const enabled = value.attendance_location_enabled === true || value.attendance_location_enabled === 'true';
  const lat = value.attendance_latitude, lng = value.attendance_longitude;
  if (enabled && (lat === '' || lat == null || !Number.isFinite(Number(lat)) || Math.abs(Number(lat)) > 90)) return {section: 'attendance', field: 'attendance_latitude', message: 'Enter a valid latitude (−90 to 90) before enabling location verification.'};
  if (enabled && (lng === '' || lng == null || !Number.isFinite(Number(lng)) || Math.abs(Number(lng)) > 180)) return {section: 'attendance', field: 'attendance_longitude', message: 'Enter a valid longitude (−180 to 180) before enabling location verification.'};
  const radius = Number(value.attendance_radius_meters || 100);
  if (!Number.isFinite(radius) || radius < 25 || radius > 2000) return {section: 'attendance', field: 'attendance_radius_meters', message: 'Use an attendance radius between 25 and 2,000 meters.'};
  return null;
}


/** Client feedback mirrors the canonical service contract; the RPC remains authoritative. */
export function validateOutletServices(value) {
  const fail=(field,message)=>({section:field==='service_policies'?'policies':'contact',field,message});
  for (const [field,label,limit] of [['phone','Public phone',80],['email','Public email',160],['website','Website',300],['service_policies','Service policies',4000]]) {
    if(typeof value[field]!=='string'||value[field].length>limit)return fail(field,`${label} must be text of at most ${limit} characters.`);
  }
  if(value.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email))return fail('email','Enter a valid public email address.');
  if(value.website&&!/^https:\/\/\S+$/.test(value.website))return fail('website','Enter a website starting with https://.');
  try {new Intl.DateTimeFormat('en',{timeZone:value.timezone}).format();} catch {return fail('timezone','Choose a valid Outlet timezone.');}
  if(!Array.isArray(value.weekly_hours)||value.weekly_hours.length!==7)return fail('timezone','Provide regular hours for all seven days.');
  if(!Array.isArray(value.special_hours)||value.special_hours.length>30)return fail('special_hours','Use at most 30 special dates.');
  for(const key of ['weekly_hours','special_hours']) {
    const seen=new Set();
    for(const [index,day] of value[key].entries()) {
      const path=`${key}.${index}`,name=key==='weekly_hours'?WEEKDAYS[day.day]:`Special date ${index+1}`;
      if(key==='weekly_hours') {
        if(!Number.isInteger(day.day)||day.day<0||day.day>6||seen.has(day.day))return fail(`${path}.status`,'Each weekday must appear once.');
        seen.add(day.day);
      } else {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Number.isFinite(Date.parse(`${day.date}T00:00:00Z`))||new Date(`${day.date}T00:00:00Z`).toISOString().slice(0,10)!==day.date||seen.has(day.date))return fail(`${path}.date`,`${name}: choose a valid, unique date.`);
        seen.add(day.date);
        if((day.reason||'').length>200)return fail(`${path}.reason`,`${name}: keep the reason within 200 characters.`);
      }
      if(!['unknown','closed','open'].includes(day.status)||!Array.isArray(day.periods)||day.periods.length>3||(day.status==='open')!==(day.periods.length>0))return fail(`${path}.status`,`${name}: choose Open with up to three periods, Closed or Not confirmed.`);
      const ranges=[];
      for(const [n,period] of day.periods.entries()) {
        const p=`${path}.periods.${n}`;
        for(const field of ['opens','closes'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(period[field]||''))return fail(`${p}.${field}`,`${name}, period ${n+1}: set the ${field==='opens'?'opening':'closing'} time.`);
        if(typeof period.overnight!=='boolean')return fail(`${p}.overnight`,`${name}: confirm whether closing is the next day.`);
        if(!period.overnight&&period.closes===period.opens)return fail(`${p}.closes`,`${name}: closing equals opening. Change the closing time, or select Closes next day only for a full 24-hour period.`);
        if(!period.overnight&&period.closes<period.opens)return fail(`${p}.closes`,`${name}: closing is before opening. Correct the time or select Closes next day.`);
        if(period.overnight&&period.closes>period.opens)return fail(`${p}.overnight`,`${name}: next-day closing must be at or before the opening time.`);
        const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),start=minutes(period.opens),end=minutes(period.closes)+(period.overnight?1440:0);
        if(ranges.some(([a,b])=>start<b&&a<end))return fail(`${p}.opens`,`${name}: opening periods overlap. Adjust this period.`);
        ranges.push([start,end]);
      }
    }
  }
  return null;
}
