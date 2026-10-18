import {it,expect} from 'vitest';
import {readServicePolicies,writeServicePolicies,validateOutletMaster,validateOutletServices} from './outletEditorModel.js';
import {emptyOutletServices} from '../../services/outletServiceProfileService.js';
it('preserves unknown policy text and exposes only explicit known service declarations',()=>{
 const original='Bookings only by phone.\nSpecial arrangements require confirmation.';
 const draft=readServicePolicies(original);expect(draft.policies).toEqual({});expect(writeServicePolicies(draft)).toBe(original);
 draft.policies['Dine-in']={status:'Available',description:'Walk-ins welcome'};
 const text=writeServicePolicies(draft);expect(text).toContain(original);expect(readServicePolicies(text)).toEqual(draft);
 expect(readServicePolicies('Delivery: Maybe\nDelivery: Available\nDelivery: Not offered').additional).toBe('Delivery: Maybe\nDelivery: Not offered');
});

it('identifies Saturday equal times without guessing overnight or changing the draft',()=>{
 const data=emptyOutletServices();data.weekly_hours=data.weekly_hours.map(d=>({...d,status:'open',periods:[{opens:'10:00',closes:d.day===6?'10:00':'22:00',overnight:false}]}));
 const before=structuredClone(data);expect(validateOutletServices(data)).toMatchObject({section:'contact',field:'weekly_hours.6.periods.0.closes',message:expect.stringContaining('Saturday')});expect(data).toEqual(before);
 data.weekly_hours[6].periods[0].closes='22:00';expect(validateOutletServices(data)).toBeNull();
});
it('preserves explicit overnight and full-day semantics and rejects overlap',()=>{
 const data=emptyOutletServices(),day=data.weekly_hours[1];day.status='open';day.periods=[{opens:'18:00',closes:'02:00',overnight:false}];
 expect(validateOutletServices(data).message).toContain('Closes next day');day.periods[0].overnight=true;expect(validateOutletServices(data)).toBeNull();
 day.periods[0].closes='18:00';expect(validateOutletServices(data)).toBeNull();
 day.periods[0].closes='19:00';expect(validateOutletServices(data).field).toBe('weekly_hours.1.periods.0.overnight');
 day.periods=[{opens:'10:00',closes:'14:00',overnight:false},{opens:'13:00',closes:'16:00',overnight:false}];expect(validateOutletServices(data).message).toContain('overlap');
 day.periods[1].opens='14:00';expect(validateOutletServices(data)).toBeNull();
});
it('validates hidden-section policies, contact and real special dates',()=>{
 const data=emptyOutletServices();data.email='manager@example.com';data.special_hours=[{date:'2026-12-25',status:'closed',periods:[],reason:'Test closure'}];expect(validateOutletServices(data)).toBeNull();
 data.special_hours[0].date='2026-02-30';expect(validateOutletServices(data).field).toBe('special_hours.0.date');
 data.special_hours=[];data.website='http://example.com';expect(validateOutletServices(data).field).toBe('website');data.website='';data.email='bad';expect(validateOutletServices(data).field).toBe('email');
 data.email='';data.service_policies='x'.repeat(4001);expect(validateOutletServices(data)).toMatchObject({section:'policies',field:'service_policies'});
});
it('does not accept blank GPS coordinates as zero, and validates disabled GPS radius and accent',()=>{
 const base={name:'Outlet',attendance_location_enabled:true,attendance_latitude:'',attendance_longitude:'',attendance_radius_meters:100};
 expect(validateOutletMaster(base).section).toBe('attendance');
 expect(validateOutletMaster({...base,attendance_latitude:0,attendance_longitude:0})).toBeNull();
 expect(validateOutletMaster({...base,attendance_location_enabled:false,attendance_radius_meters:24}).section).toBe('attendance');
 expect(validateOutletMaster({...base,name:' '}).section).toBe('general');
});
