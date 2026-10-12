import {it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import TextareaField from '../TextareaField.jsx';
it('keeps a five-line floor and grows for long content',()=>{
 const view=render(<TextareaField label="Caption" value="Short" onChange={()=>{}}/>);const input=screen.getByRole('textbox',{name:'Caption'});expect(input.rows).toBe(5);
 Object.defineProperty(input,'scrollHeight',{configurable:true,value:350});view.rerender(<TextareaField label="Caption" value="Longer caption" onChange={()=>{}}/>);expect(input.style.height).toBe('350px');cleanup();
});
