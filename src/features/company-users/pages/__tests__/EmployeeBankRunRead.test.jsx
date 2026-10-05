import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
const bank=vi.hoisted(()=>vi.fn());
vi.mock("../../../../services/employeeService.js",()=>({employeeService:{readBankInfo:bank},EMPLOYEE_BANK_CHANGE_KEY:"feedx:employee-bank-change"}));
import { useEmployeeBankRead } from "../useEmployeeBankRead.js";
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("shares one batch across stage rerenders and revalidates canonical People edits on focus",async()=>{
 bank.mockResolvedValue([{id:'employee',bank_name:''}]);
 const {result,rerender}=renderHook(({stage})=>useEmployeeBankRead('run',['employee']),{initialProps:{stage:'prepare'}});
 await waitFor(()=>expect(result.current.missingCount).toBe(1));
 rerender({stage:'review'});rerender({stage:'finalize'}); expect(bank).toHaveBeenCalledTimes(1);
 bank.mockResolvedValue([{id:'employee',bank_name:'Maybank',bank_account_name:'QA',bank_account_number:'123'}]);
 await act(async()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(result.current.missingCount).toBe(0));expect(bank).toHaveBeenCalledTimes(2);
});
it("never uses invisible employees as complete or carries old scope results forward",async()=>{
 bank.mockResolvedValue([]);
 const {result,rerender}=renderHook(({id})=>useEmployeeBankRead(id,['employee']),{initialProps:{id:'one'}});
 await waitFor(()=>expect(result.current.forEmployee('employee')).not.toBeNull());
 expect(result.current.forEmployee('employee').employee).toBeUndefined();
 bank.mockRejectedValue(new Error('outside scope'));rerender({id:'two'});
 await waitFor(()=>expect(result.current.forEmployee('employee').error).toBe(true));
 expect(result.current.missingCount).toBeNull();
});

it("revalidates bank edits when returning from a separate browser tab",async()=>{
 bank.mockResolvedValue([{id:'employee',bank_name:''}]);
 const {result}=renderHook(()=>useEmployeeBankRead('run',['employee']));
 await waitFor(()=>expect(result.current.missingCount).toBe(1));
 bank.mockResolvedValue([{id:'employee',bank_name:'Maybank',bank_account_name:'QA',bank_account_number:'123'}]);
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 await waitFor(()=>expect(result.current.missingCount).toBe(0));
});

it("reads canonical data after a matching cross-tab Employee bank save without trusting notification values",async()=>{
 bank.mockResolvedValue([{id:'employee',bank_name:''}]);
 const {result}=renderHook(()=>useEmployeeBankRead('run',['employee']));
 await waitFor(()=>expect(result.current.missingCount).toBe(1));
 bank.mockResolvedValue([{id:'employee',bank_name:'Maybank',bank_account_name:'QA',bank_account_number:'123'}]);
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:'feedx:employee-bank-change',newValue:JSON.stringify({id:'other'})})));
 expect(bank).toHaveBeenCalledTimes(1);
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:'feedx:employee-bank-change',newValue:JSON.stringify({id:'employee'})})));
 await waitFor(()=>expect(result.current.missingCount).toBe(0));
});
