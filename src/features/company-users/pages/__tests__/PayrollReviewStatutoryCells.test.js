import {expect,it} from 'vitest';
import {payrollStatutoryCell, payrollEmployeeResult} from '../payrollRunPresentation.js';
const row={preparation:{statutory_setup:{schemes:{epf:{state:'confirmed',applicable:true},socso:{state:'not_applicable',applicable:false},eis:{state:'confirmed',applicable:true},pcb:{state:'confirmed',applicable:true}}}},result:{earningsCurrent:true},pcb:{confirmation:{id:'evidence'}},statutory:{status:'ready',lines:[{scheme:'epf',employee_amount:220,employer_amount:260},{scheme:'pcb',employee_amount:45,employer_amount:0}]}};
it('uses canonical EE/ER and employee-only PCB values',()=>{
 expect(payrollStatutoryCell(row,'epf')).toEqual({state:'calculated',employee:220,employer:260});
 expect(payrollStatutoryCell(row,'pcb')).toEqual({state:'calculated',employee:45,employer:null});
});
it('distinguishes period N/A, unresolved evidence and pending calculation',()=>{
 expect(payrollStatutoryCell(row,'socso').state).toBe('N/A');
 expect(payrollStatutoryCell(row,'eis').state).toBe('Pending');
 expect(payrollStatutoryCell({...row,preparation:{}},'epf').state).toBe('Review');
 expect(payrollStatutoryCell({...row,pcb:{}},'pcb').state).toBe('Review');
 expect(payrollStatutoryCell({...row,statutory:{...row.statutory,is_stale:true}},'epf').state).toBe('Pending');
 expect(payrollStatutoryCell({...row,result:{earningsCurrent:false}},'epf').state).toBe('Pending');
});
it('never presents unresolved contribution defaults as calculated amounts',()=>{
 expect(payrollStatutoryCell({...row,statutory:{...row.statutory,issues:['epf_category_unreviewed']}},'epf').state).toBe('Review');
 expect(payrollStatutoryCell({...row,statutory:{...row.statutory,issues:['lindung_participation_unconfirmed']}},'epf').state).toBe('calculated');
});
it('keeps canonical employee deduction aggregate separate from employer shares and retains LINDUNG',()=>{
 const result=payrollEmployeeResult({status:'ready',gross_earnings:2000},{status:'ready',net_pay:1710,non_statutory_deductions:10,lines:[{employee_amount:220,employer_amount:260},{employee_amount:15,employer_amount:0},{employee_amount:45,employer_amount:0}]});
 expect(result.deductions).toBe(290);
 expect(result.net).toBe(1710);
});
