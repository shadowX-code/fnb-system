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
  if (!value.name?.trim()) return {section: 'general', message: 'Enter an Outlet name.'};
  const enabled = value.attendance_location_enabled === true || value.attendance_location_enabled === 'true';
  const lat = value.attendance_latitude, lng = value.attendance_longitude;
  if (enabled && (lat === '' || lat == null || lng === '' || lng == null || !Number.isFinite(Number(lat)) || Math.abs(Number(lat)) > 90 || !Number.isFinite(Number(lng)) || Math.abs(Number(lng)) > 180)) return {section: 'attendance', message: 'Enter valid latitude (−90 to 90) and longitude (−180 to 180) before enabling location verification.'};
  const radius = Number(value.attendance_radius_meters || 100);
  if (!Number.isFinite(radius) || radius < 25 || radius > 2000) return {section: 'attendance', message: 'Use an attendance radius between 25 and 2,000 meters.'};
  return null;
}
