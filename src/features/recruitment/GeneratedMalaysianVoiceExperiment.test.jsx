import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
const qa=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../../lib/supabase.ts',()=>({supabase:{functions:qa}}));
import Experiment from './GeneratedMalaysianVoiceExperiment.jsx';
afterEach(()=>{cleanup();qa.invoke.mockReset();});
it('reads cache only on mount and shows exact blocked result without voice regeneration',async()=>{
 qa.invoke.mockResolvedValue({data:{status:'blocked',provider_status:403,provider_code:'permission_denied',message:'Project not eligible'}});
 render(<Experiment/>);
 expect((await screen.findByRole('status')).textContent).toContain('Project not eligible');
 expect(qa.invoke).toHaveBeenCalledOnce();expect(qa.invoke.mock.calls[0][1].body).toEqual({action:'status'});
 expect(screen.queryByRole('button',{name:'Check project access'})).toBeNull();
});
it('requires explicit probe and then hides creation control',async()=>{
 qa.invoke.mockResolvedValueOnce({data:{status:'not_checked'}}).mockResolvedValueOnce({data:{status:'blocked',provider_status:403,message:'Access unavailable'}});
 render(<Experiment/>);const button=await screen.findByRole('button',{name:'Check project access'});
 fireEvent.click(button);expect((await screen.findByRole('status')).textContent).toContain('Access unavailable');
 expect(qa.invoke.mock.calls[1][1].body).toEqual({action:'probe'});
});
