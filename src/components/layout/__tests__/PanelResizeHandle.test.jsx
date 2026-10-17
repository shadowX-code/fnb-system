import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import PanelResizeHandle from '../PanelResizeHandle.jsx';
afterEach(cleanup);
it('offers bounded keyboard resizing without changing any application state itself',()=>{
 const onChange=vi.fn();render(<PanelResizeHandle label="Conversation width" value={300} min={260} max={420} onChange={onChange}/>);
 const handle=screen.getByRole('separator',{name:'Conversation width'});
 expect(handle.getAttribute('aria-orientation')).toBe('vertical');
 fireEvent.keyDown(handle,{key:'ArrowRight'});expect(onChange).toHaveBeenLastCalledWith(316);
 fireEvent.keyDown(handle,{key:'Home'});expect(onChange).toHaveBeenLastCalledWith(260);
 fireEvent.keyDown(handle,{key:'End'});expect(onChange).toHaveBeenLastCalledWith(420);
});
it('reverses the right-panel direction and clamps at its limit',()=>{
 const onChange=vi.fn();render(<PanelResizeHandle label="Context width" value={260} min={260} max={360} reverse onChange={onChange}/>);
 fireEvent.keyDown(screen.getByRole('separator'),{key:'ArrowRight'});expect(onChange).toHaveBeenCalledWith(260);
});
