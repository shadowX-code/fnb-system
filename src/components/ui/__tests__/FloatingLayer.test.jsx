import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,act,cleanup} from '@testing-library/react';
import FloatingLayer from '../FloatingLayer.jsx';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('repositions resized content against its anchor and disconnects the observer on close',()=>{
 let resize,height=300;const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class {constructor(cb){resize=cb}observe(){}disconnect=disconnect});
 vi.stubGlobal('requestAnimationFrame',cb=>{cb();return 1});vi.stubGlobal('cancelAnimationFrame',vi.fn());
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockImplementation(()=>height);Object.defineProperty(window,'innerHeight',{configurable:true,value:800});
 const anchor={current:document.createElement('button')};anchor.current.getBoundingClientRect=()=>({top:500,bottom:530,left:100,right:180,width:80,height:30});document.body.append(anchor.current);
 const view=render(<FloatingLayer open anchorRef={anchor} width={360}><div>Saved text</div></FloatingLayer>);const layer=screen.getByText('Saved text').parentElement.parentElement;
 expect(layer.style.top).toBe('192px');height=150;act(()=>resize());expect(layer.style.top).toBe('538px');view.rerender(<FloatingLayer open={false} anchorRef={anchor}>Saved text</FloatingLayer>);expect(disconnect).toHaveBeenCalled();anchor.current.remove();
});
