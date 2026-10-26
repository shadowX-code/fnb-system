import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {NotificationSoundSettings} from '../NotificationSoundControls.jsx';
afterEach(cleanup);
it('requires explicit enable, explains per-tab readiness and offers bounded volume/preview controls',async()=>{
 const sound={enabled:false,ready:false,available:true,volume:.25,client:{enable:vi.fn().mockResolvedValue(),disable:vi.fn(),setVolume:vi.fn(),preview:vi.fn()}};
 const view=render(<NotificationSoundSettings sound={sound}/>);expect(sound.client.enable).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Preview sound'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Enable sounds'}));await waitFor(()=>expect(sound.client.enable).toHaveBeenCalledOnce());
 view.rerender(<NotificationSoundSettings sound={{...sound,enabled:true,ready:true}}/>);expect(screen.getByRole('status',{name:'Inbox sound readiness'}).textContent).toBe('Ready in this tab');fireEvent.change(screen.getByRole('slider',{name:'Inbox sound volume'}),{target:{value:'50'}});expect(sound.client.setVolume).toHaveBeenCalledWith(.5);fireEvent.click(screen.getByRole('button',{name:'Preview sound'}));expect(sound.client.preview).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Turn off'}));expect(sound.client.disable).toHaveBeenCalledOnce();
});
