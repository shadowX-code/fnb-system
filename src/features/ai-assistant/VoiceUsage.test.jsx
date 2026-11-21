import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import VoiceUsage from './VoiceUsage.jsx';
import {assistantCall} from './nativeAssistantService.js';
vi.mock('./nativeAssistantService.js',()=>({assistantCall:vi.fn()}));
const data={environment:'staging',can_edit:true,state:'available',policy:{enabled:true,revision:2,max_seconds:180,max_concurrent_sessions:4,per_user_daily_sessions:null},sessions:[],adjustments:[],summary:{sessions:0,duration_seconds:null,duration_sessions:0,estimated_sessions:0,partial_sessions:0,cost_nano_usd:null},page_size:30,filtered_count:0,as_of:"2026-11-22T04:00:00Z"};
afterEach(cleanup);beforeEach(()=>{vi.mocked(assistantCall).mockReset().mockResolvedValue(data);});
it('development usage does not present an exhausted call allowance or mandatory approval',async()=>{
 render(<VoiceUsage/>);await screen.findByText(/Development voice enabled/);
 expect(screen.queryByText('Request approval')).toBeNull();expect(screen.getByText(/No fixed evaluation allowance/)).toBeTruthy();
 expect(screen.queryByRole('spinbutton')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Edit policy'}));expect(screen.getByLabelText('Optional daily sessions per user').value).toBe('');
});
it('Admin disable saves the environment policy without purchasing or granting allowance',async()=>{
 const saved=vi.fn();render(<VoiceUsage onSaved={saved}/>);await screen.findByText(/Development voice enabled/);
 fireEvent.click(screen.getByRole('button',{name:'Edit policy'}));fireEvent.click(screen.getByLabelText('Enable Staging voice'));fireEvent.click(screen.getByText('Save limits'));
 await waitFor(()=>expect(assistantCall).toHaveBeenCalledWith('voice_policy_save',{revision:2,enabled:false,maximum_seconds:180,concurrency:4,daily_sessions:null}));
 await waitFor(()=>expect(saved).toHaveBeenCalled());
});
it('ordinary users cannot change environment availability',async()=>{
 vi.mocked(assistantCall).mockResolvedValue({...data,can_edit:false});render(<VoiceUsage/>);await screen.findByText(/Development voice enabled/);expect(screen.queryByText('Save limits')).toBeNull();
});
it('filters observed usage, preserves zero tokens and does not fabricate missing costs',async()=>{
 const sessions=[
  {request_id:'one',actor:'tester-one',provider:'openai',state:'closed',created_at:'2026-11-08T10:00:00Z',observed_duration_seconds:12,observed_usage:{input_audio_tokens:0,output_audio_tokens:42}},
  {request_id:'two',actor:'tester-two',provider:'grok',state:'failed',created_at:'2026-11-08T11:00:00Z',reason:'provider_rejected'},
 ];
 assistantCall.mockImplementation(async(_,filters)=>{
  const rows=filters?.status==='failed'?[sessions[1]]:sessions;
  return {...data,sessions:rows,filtered_count:rows.length,summary:{...data.summary,sessions:32}};
 });
 render(<VoiceUsage/>);
 const table=await screen.findByRole('table');
 expect(within(table).getAllByLabelText('Cost unavailable')).toHaveLength(2);
 expect(within(table).getByText('0 / 42')).toBeTruthy();
 expect(within(table).getByText('OpenAI')).toBeTruthy();
 expect(within(table).getByText('Provider rejected')).toBeTruthy();
 expect(within(table).queryByRole('button',{name:/Details/})).toBeNull();
 expect(screen.getByText('0 estimated · 0 partial · 32 unavailable')).toBeTruthy();
 expect(screen.getByText('Not connected')).toBeTruthy();
 expect(screen.getByRole('link',{name:'OpenAI Billing'}).href).toContain('/organization/billing/overview');
 fireEvent.click(screen.getByRole('button',{name:'Status',exact:true}));
 fireEvent.click(await screen.findByRole('option',{name:'Failed',exact:true}));
 await screen.findByText(/1 matching sessions/);
 expect(screen.queryByText('0 / 42')).toBeNull();
 expect(assistantCall).toHaveBeenLastCalledWith('voice_usage',{period:'month',status:'failed',page:1},expect.any(AbortSignal));
 fireEvent.click(screen.getByRole('button',{name:'Period',exact:true}));
 fireEvent.click(await screen.findByRole('option',{name:'Last 7 days',exact:true}));
 await waitFor(()=>expect(assistantCall).toHaveBeenLastCalledWith('voice_usage',{period:'7d',status:'failed',page:1},expect.any(AbortSignal)));
});
it('cannot activate a non-Staging policy even if the response says editable',async()=>{
 assistantCall.mockResolvedValue({...data,environment:'production',policy:{...data.policy,enabled:false}});render(<VoiceUsage/>);await screen.findByText('Voice disabled');expect(screen.queryByText('Save limits')).toBeNull();
});
it('cancel restores policy view without saving or changing the authority',async()=>{
 render(<VoiceUsage/>);await screen.findByText('Development voice enabled');
 fireEvent.click(screen.getByRole('button',{name:'Edit policy'}));fireEvent.change(screen.getByRole('spinbutton',{name:'Maximum session (seconds)'}),{target:{value:'60'}});
 fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.getByText(/3m 0s max/)).toBeTruthy();expect(assistantCall.mock.calls.map(args=>args.slice(0,2))).toEqual([['voice_usage',{period:'month',status:'all',page:1}]]);
 fireEvent.click(screen.getByRole('button',{name:'Edit policy'}));expect(screen.getByRole('spinbutton',{name:'Maximum session (seconds)'}).value).toBe('180');
});
it('does not present an unsuccessful policy save as a new policy',async()=>{
 assistantCall.mockImplementation(async action=>{if(action==='voice_policy_save')throw new Error('Configuration changed. Refresh before saving.');return data;});
 render(<VoiceUsage/>);await screen.findByText('Development voice enabled');fireEvent.click(screen.getByRole('button',{name:'Edit policy'}));fireEvent.click(screen.getByRole('button',{name:'Save limits'}));
 await screen.findByRole('alert');expect(screen.queryByText('Voice policy saved.')).toBeNull();expect(screen.getByRole('button',{name:'Cancel',exact:true})).toBeTruthy();
});
