import {beforeEach, expect, it} from 'vitest';
import {CUSTOMER_COLUMNS, DEFAULT_CUSTOMER_COLUMNS, preferredCustomerColumns, saveCustomerColumns, posMetric, customerDate} from '../customerPresentation.js';
beforeEach(()=>localStorage.clear());
it('defaults to the operational nine columns and exposes sixteen choices',()=>{
 expect(CUSTOMER_COLUMNS).toHaveLength(16);
 expect(preferredCustomerColumns('new')).toEqual(DEFAULT_CUSTOMER_COLUMNS);
 expect(DEFAULT_CUSTOMER_COLUMNS).toEqual(['name','phone_e164','total_visit','total_spent','last_visit','tags','outlet','consent','actions']);
});
it('preserves legacy visibility and persists independent user choices and reset',()=>{
 localStorage.setItem('marketing.customers.columns.legacy', JSON.stringify(['name','email']));
 expect(preferredCustomerColumns('legacy')).toEqual(['name','email','consent','activity','actions']);
 saveCustomerColumns('legacy',['name','email']);
 expect(preferredCustomerColumns('legacy')).toEqual(['name','email','actions']);
 expect(preferredCustomerColumns('other')).toEqual(DEFAULT_CUSTOMER_COLUMNS);
 saveCustomerColumns('legacy',DEFAULT_CUSTOMER_COLUMNS);
 expect(preferredCustomerColumns('legacy')).toEqual(DEFAULT_CUSTOMER_COLUMNS);
});
it('formats imported zero, amounts and dates without substituting unavailable data',()=>{
 const c={pos_snapshot:{metrics:{total_visit:0,total_spent:0,avg_spent:12.5,last_visit:'2026-10-13'}}};
 expect(posMetric(c,'total_visit')).toBe('0');
 expect(posMetric(c,'total_spent')).toContain('0.00');
 expect(posMetric(c,'avg_spent')).toContain('12.50');
 expect(posMetric(c,'member_since')).toBe('—');
 expect(posMetric(c,'last_visit')).toBe(customerDate('2026-10-13'));
});
it('never hides identity/actions from old preferences and ignores removed keys',()=>{
 saveCustomerColumns('locked',['total_spent','removed']);expect(preferredCustomerColumns('locked')).toEqual(['name','total_spent','actions']);
});
