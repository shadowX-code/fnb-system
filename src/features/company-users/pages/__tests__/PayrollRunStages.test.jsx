import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const mocks=vi.hoisted(()=>({bank:vi.fn(),history:vi.fn(),readRunEvidence:vi.fn(),recalculateEmployee:vi.fn()}));
vi.mock("../../../../services/employeeService.js",()=>({employeeService:{readBankInfo:mocks.bank}}));
vi.mock("../../../../services/payrollService.js",()=>({payrollService:{readRunHistory:mocks.history,readRunEvidence:mocks.readRunEvidence,recalculateEmployee:mocks.recalculateEmployee}}));
import { RunsTab } from "../PayrollPage.jsx";
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("reuses run evidence and bank batch through Prepare, Review, Finalize and Resolve",async()=>{
 mocks.bank.mockResolvedValue([{id:'employee',bank_name:''}]);mocks.history.mockResolvedValue([]);
 const evidence={time:[],pcb:{results:[]},preparation:{results:[{employee_id:'employee',projection:{status:'ready'},statutory_setup:{complete:true,schemes:Object.fromEntries(['epf','socso','lindung','eis','pcb'].map(scheme=>[scheme,{state:'confirmed',applicable:true}]))}}]},
 calculation:{results:[{employee_id:'employee',status:'ready',gross_earnings:2000}],adjustments:[]},statutory:{results:[{employee_id:'employee',status:'ready',net_pay:1696,non_statutory_deductions:10,total_employer_cost:2301,employer_statutory_cost:301,lines:[{scheme:'epf',employee_amount:220,employer_amount:260},{scheme:'socso',employee_amount:10,employer_amount:35},{scheme:'lindung',employee_amount:15,employer_amount:0},{scheme:'eis',employee_amount:4,employer_amount:6},{scheme:'pcb',employee_amount:45,employer_amount:0}]}]}};
 const props={data:{legal_entities:[{id:'entity',name:'QA'}],employees:[{id:'employee',name:'QA Employee'}],periods:[{legal_entity_id:'entity',period_start:'2026-09-01',runs:[{id:'run',status:'draft'}]}]},
 entityId:'entity',month:'2026-09',openRunId:'run',canManage:true,canFinalize:true,canEditEmployee:true,setStep:vi.fn(),runRead:{data:evidence,setTimeReviewActive:vi.fn()},readiness:{runId:'run',time:{ready:true},calculation:{ready:false,employees:1,employment_issue:'employment_history_unresolved',uncalculated:0,review_required:0,stale:0},statutory:{ready:true}}};
 const {rerender}=render(<RunsTab {...props} step={0}/>);
 await screen.findByRole('button',{name:'View time evidence for QA Employee'}); await waitFor(()=>expect(mocks.bank).toHaveBeenCalledTimes(1));
 expect(screen.getByText('Employee readiness: 1 / 1 ready')).toBeTruthy();expect(screen.getByText('Run readiness: 1 blocker remaining')).toBeTruthy();
 rerender(<RunsTab {...props} step={1}/>);
 expect(screen.getByRole('button',{name:'View Payroll for QA Employee'})).toBeTruthy();
 expect(screen.queryByText('Loading monthly employee evidence…')).toBeNull();
 expect(screen.getAllByRole('columnheader').map(el=>el.textContent).slice(-3)).toEqual(['Bank','Status','Actions']);
 expect(screen.getAllByRole('columnheader').map(el=>el.textContent).slice(4,9)).toEqual(['EPF','SOCSO','LINDUNG 24 Jam','EIS','PCB']);
 const reviewRow=screen.getByRole('button',{name:'View Payroll for QA Employee'}).closest('tr');
 const reviewCells=within(reviewRow).getAllByRole('cell');
 expect(reviewCells[6].textContent).toMatch(/EE RM\s*15.00ER RM\s*0.00/);
 expect(reviewCells[9].textContent).toMatch(/RM\s*304.00/);
 expect(reviewCells[10].textContent).toMatch(/RM\s*1,696.00/);
 expect(reviewCells[11].textContent).toMatch(/RM\s*2,301.00/);
 expect(screen.getByRole('button',{name:'Draft Payslip'}).querySelector('svg')).toBeNull();
 expect(screen.getByRole('button',{name:'Draft Payslip'}).classList.contains('whitespace-nowrap')).toBe(true);
 expect(within(screen.getByRole('region',{name:'Payroll Run Header'})).getByRole('navigation',{name:'Payroll Run stages'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Review · Current'}).getAttribute('aria-current')).toBe('step');
 expect(screen.queryByRole('heading',{name:'Review Payroll'})).toBeNull();
 expect(screen.getByRole('button',{name:'Prepare · Completed'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Finalize · Pending'})).toBeTruthy();
 expect(screen.queryByText('Upcoming')).toBeNull();
 expect(screen.queryByText('Employee preparation is ready for review.')).toBeNull();
 rerender(<RunsTab {...props} step={2}/>);
 expect(screen.getByRole('region',{name:'Finalize Payroll'})).toBeTruthy();expect(screen.getByRole('button',{name:'Finalize Payroll'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Resolve Employment History'}));expect(props.setStep).toHaveBeenCalledWith(0);
 rerender(<RunsTab {...props} step={0}/>);
 await screen.findByRole('button',{name:'View time evidence for QA Employee'});
 expect(mocks.bank).toHaveBeenCalledTimes(1);expect(mocks.history).not.toHaveBeenCalled();
 expect(mocks.readRunEvidence).not.toHaveBeenCalled();expect(mocks.recalculateEmployee).not.toHaveBeenCalled();
});

it("switches open Run context without substituting the month and offers an empty period", async () => {
 mocks.bank.mockResolvedValue([]); mocks.history.mockResolvedValue([]);
 const data={legal_entities:[{id:'a',name:'Company A'},{id:'b',name:'Company B'},{id:'empty',name:'No Run Company'}],employees:[],periods:[
  {legal_entity_id:'a',period_start:'2026-09-01',runs:[{id:'a-run',revision:1,status:'draft'}]},
  {legal_entity_id:'b',period_start:'2026-09-01',runs:[{id:'b-run',revision:3,status:'draft'}]},
  {legal_entity_id:'empty',period_start:'2026-08-01',runs:[{id:'old-run',revision:1,status:'draft'}]}]};
 function Workspace(){
  const [entityId,setEntity]=useState('a'),[month,setMonth]=useState('2026-09'),[openRunId,setOpenRunId]=useState('a-run'),[step,setStep]=useState(0);
  return <RunsTab data={data} entityId={entityId} setEntityId={value=>{setEntity(value);setOpenRunId('');}} month={month} setMonth={setMonth} openRunId={openRunId} setOpenRunId={setOpenRunId} step={step} setStep={setStep} canManage runRead={{data:{}}} />;
 }
 render(<Workspace/>);
 fireEvent.click(screen.getByRole('button',{name:'Legal Entity',exact:true}));
 fireEvent.click(screen.getByRole('option',{name:'Company B',exact:true}));
 expect(screen.getByText('Revision 3')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Pay Period'}).textContent).toContain('September 2026');
 fireEvent.click(screen.getByRole('button',{name:'Legal Entity',exact:true}));
 fireEvent.click(screen.getByRole('option',{name:'No Run Company',exact:true}));
 expect(screen.getByText('No Payroll Run exists for this Legal Entity and pay period.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Pay Period'}).textContent).toContain('September 2026');
 expect(screen.queryByText('Revision 1')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Pay Period'}));
 fireEvent.click(screen.getByRole('gridcell',{name:'Aug'}));
 expect(screen.getByText('Revision 1')).toBeTruthy();
 expect(screen.queryByText('No Payroll Run exists for this Legal Entity and pay period.')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'‹ Payroll Runs'}));
 await screen.findByText('No Payroll Runs match these filters.');
});

it("keeps Prepare exceptions concise, detailed guidance in Review and recovery conditional", async () => {
 mocks.bank.mockResolvedValue([]);
 const refresh=vi.fn().mockResolvedValue({});
 const schemes={epf:{state:'not_applicable',applicable:false},socso:{state:'not_applicable',applicable:false},eis:{state:'not_applicable',applicable:false},pcb:{state:'not_applicable',applicable:false},lindung:{state:'confirmation_required',issue:'lindung_participation_unconfirmed:2026-09-01'}};
 const evidence={time:[],pcb:{results:[]},preparation:{results:[{employee_id:'employee',projection:{status:'review_required'},statutory_setup:{complete:false,schemes}}]},calculation:{results:[{employee_id:'employee',status:'review_required'}]},statutory:{results:[{employee_id:'employee',status:'review_required'}]}};
 const props={data:{legal_entities:[{id:'entity',name:'QA'}],employees:[{id:'employee',name:'QA Employee'}],periods:[{legal_entity_id:'entity',period_start:'2026-09-01',runs:[{id:'run',status:'draft'}]}]},entityId:'entity',month:'2026-09',openRunId:'run',step:0,canManage:true,setStep:vi.fn(),runRead:{data:evidence,refresh}};
 const {rerender}=render(<RunsTab {...props}/>);
 const table=await screen.findByRole('table');
 expect(within(table).getByText('LINDUNG 24 Jam status unconfirmed')).toBeTruthy();
 expect(within(table).queryByText(/Open Manage Statutory Setup/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Refresh time evidence'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Retry Evidence Sync'})).toBeNull();
 expect(screen.getByRole('button',{name:'Continue to Review'}).className).toBe('btn-secondary');
 fireEvent.click(within(table).getByRole('button',{name:'Resolve statutory issues for QA Employee'}));
 expect(within(screen.getByRole('dialog')).getByText(/Open Manage Statutory Setup/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Close',exact:true}));
 rerender(<RunsTab {...props} runRead={{...props.runRead,error:new Error('read failed')}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Retry Evidence Sync'}));
 await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
 rerender(<RunsTab {...props}/>);
 expect(screen.queryByRole('button',{name:'Retry Evidence Sync'})).toBeNull();
});
