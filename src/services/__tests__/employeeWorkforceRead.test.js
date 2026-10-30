import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),order:vi.fn(),range:vi.fn()}));
vi.mock('../../lib/supabase',()=>({supabase:{from:mocks.from}}));
import {employeeService} from '../employeeService.js';
beforeEach(()=>{vi.resetAllMocks();mocks.from.mockReturnValue(mocks);mocks.select.mockReturnValue(mocks);mocks.order.mockReturnValue(mocks);});
it('paginates the complete RLS-scoped minimal read without substituting classification defaults',async()=>{
 mocks.range.mockResolvedValueOnce({data:[{id:'a',employment_type:null},{id:'b',employment_type:'custom'}],count:3,error:null}).mockResolvedValueOnce({data:[{id:'c',employment_type:''}],count:3,error:null});
 const rows=await employeeService.readWorkforce();expect(rows).toHaveLength(3);expect(rows[0].employment_type).toBeNull();
 expect(mocks.range.mock.calls).toEqual([[0,499],[2,501]]);
 expect(mocks.select).toHaveBeenCalledWith('id,legal_entity_id,employment_type,employment_status',{count:'exact'});
});
it('rejects incomplete evidence instead of publishing partial counts as complete',async()=>{
 mocks.range.mockResolvedValueOnce({data:[],count:3,error:null});await expect(employeeService.readWorkforce()).rejects.toThrow('Complete workforce');
});
