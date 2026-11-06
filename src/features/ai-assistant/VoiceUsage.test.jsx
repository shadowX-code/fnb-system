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
