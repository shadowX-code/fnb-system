import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import Modal from '../Modal.jsx';
it('nested media dialog handles Escape without closing the post form',()=>{
 const parentClose=vi.fn(),childClose=vi.fn();render(<Modal title="Post" onClose={parentClose}><input aria-label="Caption"/><Modal title="Picker" onClose={childClose}><button>Select</button></Modal></Modal>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Select'}),{key:'Escape'});expect(childClose).toHaveBeenCalledOnce();expect(parentClose).not.toHaveBeenCalled();cleanup();
});
