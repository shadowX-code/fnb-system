import {expect,it,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import VoiceInteraction,{voicePresentation} from './VoiceInteraction.jsx';
it('uses one control and accurately distinguishes reconnect, ending, background suspension and unavailability',()=>{
 const ready={state:'idle',active:false,sdkVoice:true,voiceDefault:{provider:'openai',voice:'cedar'},voicePolicy:{state:'available',maximum_seconds:180},available:{openai:true}};
 expect(voicePresentation({...ready,state:'error'}).label).toBe('Reconnect voice');expect(voicePresentation({...ready,state:'ending'}).disabled).toBe(true);
 const start=vi.fn(),stop=vi.fn(),controller={current:{start,stop}};
 const view=render(<VoiceInteraction state={ready} controller={controller} immersive/>);
 expect(screen.getByRole('button',{name:'Start voice'}).textContent).toBe('');
 expect(screen.queryByText('Voice status')).toBeNull();
 for(const [state,label] of Object.entries({listening:'Listening',speaking:'Speaking',thinking:'Thinking',connecting:'Connecting',reconnecting:'Reconnecting',error:'Connection error'})){
  view.rerender(<VoiceInteraction immersive state={{...ready,state,active:state!=='error'}} controller={controller}/>);
  expect(screen.getByRole('status').textContent).toBe(label);
 }
 view.rerender(<VoiceInteraction immersive state={ready} controller={controller}/>);
 fireEvent.click(screen.getByRole('button',{name:'Start voice'}));expect(start).toHaveBeenCalledWith('openai','cedar');
 view.rerender(<VoiceInteraction state={{...ready,state:'reconnecting',active:true}} controller={controller}/>);
 expect(screen.getByText('Reconnecting',{exact:true}).textContent).toBe('Reconnecting');fireEvent.click(screen.getByRole('button',{name:'End voice'}));expect(stop).toHaveBeenCalledOnce();
 view.rerender(<VoiceInteraction state={{...ready,state:'suspended',active:true}} controller={controller}/>);expect(screen.getByText('Microphone suspended',{exact:true}).textContent).toBe('Microphone suspended');
 view.rerender(<VoiceInteraction state={{...ready,voicePolicy:{state:'active_elsewhere'}}} controller={controller}/>);expect(screen.getByRole('button',{name:'Finishing previous call'}).disabled).toBe(true);view.unmount();
});
