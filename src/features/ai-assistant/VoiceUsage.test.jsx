import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import VoiceUsage from './VoiceUsage.jsx';
import {assistantCall} from './nativeAssistantService.js';
vi.mock('./nativeAssistantService.js',()=>({assistantCall:vi.fn()}));
const data={environment:'staging',can_edit:true,state:'available',policy:{enabled:true,revision:2,max_seconds:180,max_concurrent_sessions:4,per_user_daily_sessions:null},sessions:[],adjustments:[]};
afterEach(cleanup);beforeEach(()=>{vi.mocked(assistantCall).mockReset().mockResolvedValue(data);});
it('development usage does not present an exhausted call allowance or mandatory approval',async()=>{
 render(<VoiceUsage/>);await screen.findByText(/Development voice enabled/);
 expect(screen.queryByText('Request approval')).toBeNull();expect(screen.getByText(/No fixed evaluation allowance/)).toBeTruthy();
 expect(screen.getByLabelText('Optional daily sessions per user').value).toBe('');
});
it('Admin disable saves the environment policy without purchasing or granting allowance',async()=>{
 const saved=vi.fn();render(<VoiceUsage onSaved={saved}/>);await screen.findByText(/Development voice enabled/);
 fireEvent.click(screen.getByLabelText('Enable Staging voice'));fireEvent.click(screen.getByText('Save limits'));
 await waitFor(()=>expect(assistantCall).toHaveBeenCalledWith('voice_policy_save',{revision:2,enabled:false,maximum_seconds:180,concurrency:4,daily_sessions:null}));
 await waitFor(()=>expect(saved).toHaveBeenCalled());
});
it('ordinary users cannot change environment availability',async()=>{
 vi.mocked(assistantCall).mockResolvedValue({...data,can_edit:false});render(<VoiceUsage/>);await screen.findByText(/Development voice enabled/);expect(screen.queryByText('Save limits')).toBeNull();
});
it('filters observed usage, preserves zero tokens and does not fabricate missing costs',async()=>{
 assistantCall.mockResolvedValue({...data,sessions:[
  {request_id:'one',actor:'tester-one',provider:'openai',state:'closed',created_at:'2026-11-08T10:00:00Z',observed_duration_seconds:12,observed_usage:{input_audio_tokens:0,output_audio_tokens:42}},
  {request_id:'two',actor:'tester-two',provider:'grok',state:'failed',created_at:'2026-11-08T11:00:00Z',reason:'provider_rejected'},
 ]});render(<VoiceUsage/>);await screen.findByText('0 / 42');expect(screen.getAllByText('Unavailable').length).toBe(2);
 fireEvent.click(screen.getByRole('button',{name:'Status',exact:true}));fireEvent.click(await screen.findByRole('option',{name:'Failed',exact:true}));
 expect(screen.queryByText('0 / 42')).toBeNull();expect(screen.getByText('1 of 2 sessions')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Clear all'}));fireEvent.change(screen.getByRole('searchbox',{name:'Search sessions'}),{target:{value:'tester-one'}});
 expect(screen.getByText('0 / 42')).toBeTruthy();expect(screen.queryByText('provider rejected')).toBeNull();
 expect(assistantCall.mock.calls).toEqual([['voice_usage']]);
});
it('cannot activate a non-Staging policy even if the response says editable',async()=>{
 assistantCall.mockResolvedValue({...data,environment:'production',policy:{...data.policy,enabled:false}});render(<VoiceUsage/>);await screen.findByText('Voice disabled');expect(screen.queryByText('Save limits')).toBeNull();
});
