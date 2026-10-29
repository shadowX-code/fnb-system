import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import AccessScopeSummary from './AccessScopeSummary.jsx';
import {accessScopeSummary} from './accessScopeSummary.js';
afterEach(cleanup);
const catalog=[{module_id:'locations',label:'Locations'},{module_id:'production',label:'Production Records'}];
it('summarizes MeSTI scope without turning contextual references into full related access',()=>{
 const c={module_id:'cleaning',label:'Cleaning',name:'nav_cleaning_view',permission:'technical.view',scope:[{resource:'requirements',label:'Requirements',fields:['subject_id'],context_fields:{subject_id:'locations',unused_id:'production'}}]};
 const scope=accessScopeSummary(c,catalog);
 expect(scope.included).toEqual(['Requirements','Basic related references: Locations']);
 expect(scope.separate).toEqual([{label:'Full related records',sources:['Locations']}]);
 render(<AccessScopeSummary capability={c} catalog={catalog}/>);
 const disclosure=screen.getByText('Access Details').closest('details');expect(disclosure.open).toBe(false);
 fireEvent.click(screen.getByText('Access Details'));
 expect(screen.getByRole('region',{name:'Included with this access'})).toBeTruthy();
 expect(screen.getByText('Developer Diagnostics').closest('details').open).toBe(false);
 expect(document.querySelector('pre')).toBeNull();
 fireEvent.click(screen.getByText('Developer Diagnostics'));expect(screen.getByText('technical.view')).toBeTruthy();
});
it('keeps Production source-gated records and costs out of standalone inclusion',()=>{
 const c={module_id:'overview',required_modules:[{id:'production',label:'Production Records'}],capability_limitation:'Calculated report totals are unavailable.',scope:[{label:'Production records',fields:['total_cost'],required_modules:['production']}]};
 const scope=accessScopeSummary(c,catalog);
 expect(scope.included).toEqual([]);expect(scope.separate).toEqual([{label:'Production records',sources:['Production Records']}]);
 expect(scope.notes).toEqual(['Calculated report totals are unavailable.']);
});
it('includes Warehouse prices and Raw Materials costs only when declared by an ungated owning projection',()=>{
 const warehouse=accessScopeSummary({module_id:'warehouse',scope:[{label:'Finished goods',fields:['current_balance','b2b_price'],required_modules:[]}]});
 expect(warehouse.included).toEqual(['Finished goods','Current stock balances','Saved selling prices']);
 const raw=accessScopeSummary({module_id:'raw',scope:[{label:'Raw materials',fields:['manual_unit_cost'],required_modules:[]}]});
 expect(raw.included).toEqual(['Raw materials','Saved manual cost basis']);expect(raw.notes).toEqual([]);
});
it('shows retained scopes without promising raw collections or inventing field mappings',()=>{
 const c={retained_only:true,name:'saved_review',scope:[{label:'Compliance review records',resource:'mesti_review'}]};
 const scope=accessScopeSummary(c);expect(scope.included).toEqual(['Compliance review records']);expect(scope.separate[0].label).toMatch(/Broader module/);
 render(<AccessScopeSummary capability={c}/>);expect(screen.getByText('Field mappings are not supplied for this saved grant.')).toBeTruthy();
});
