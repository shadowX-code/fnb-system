import {it,expect} from 'vitest';
import {readServicePolicies,writeServicePolicies,validateOutletMaster} from './outletEditorModel.js';
it('preserves unknown policy text and exposes only explicit known service declarations',()=>{
 const original='Bookings only by phone.\nSpecial arrangements require confirmation.';
 const draft=readServicePolicies(original);expect(draft.policies).toEqual({});expect(writeServicePolicies(draft)).toBe(original);
 draft.policies['Dine-in']={status:'Available',description:'Walk-ins welcome'};
 const text=writeServicePolicies(draft);expect(text).toContain(original);expect(readServicePolicies(text)).toEqual(draft);
 expect(readServicePolicies('Delivery: Maybe\nDelivery: Available\nDelivery: Not offered').additional).toBe('Delivery: Maybe\nDelivery: Not offered');
});
it('does not accept blank GPS coordinates as zero, and validates disabled GPS radius and accent',()=>{
 const base={name:'Outlet',attendance_location_enabled:true,attendance_latitude:'',attendance_longitude:'',attendance_radius_meters:100};
 expect(validateOutletMaster(base).section).toBe('attendance');
 expect(validateOutletMaster({...base,attendance_latitude:0,attendance_longitude:0})).toBeNull();
 expect(validateOutletMaster({...base,attendance_location_enabled:false,attendance_radius_meters:24}).section).toBe('attendance');
 expect(validateOutletMaster({...base,name:' '}).section).toBe('general');
});
