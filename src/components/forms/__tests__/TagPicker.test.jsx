import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {useState} from 'react';
import TagPicker from '../TagPicker.jsx';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function Harness(){const [tags,setTags]=useState([]);return <TagPicker value={tags} options={['VIP','Regular']} onChange={setTags} allowCreate/>}
describe('shared tag picker',()=>{
 it('keeps focus in New tag through successive keystrokes',()=>{
  const frames=[];
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  const flush=()=>{const pending=frames.splice(0);pending.forEach(callback=>callback());};
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Tags',exact:true}));
  flush();
  const input=screen.getByRole('textbox',{name:'New tag'});
  input.focus();
  for(const value of ['V','VI','VIP new']){
   fireEvent.change(input,{target:{value}});flush();
   expect(document.activeElement).toBe(input);
  }
  fireEvent.keyDown(input,{key:'Enter'});
  expect(screen.getByRole('button',{name:'Remove tag VIP new'})).toBeTruthy();
 });
 it('selects existing tags, adds a trimmed new tag and removes selections',()=>{render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Tags',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'Search Tags'}),{target:{value:'vi'}});fireEvent.click(screen.getByRole('option',{name:'VIP'}));expect(screen.getByRole('button',{name:'Remove tag VIP'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Tags',exact:true}));fireEvent.change(screen.getByRole('textbox',{name:'New tag'}),{target:{value:' Lunch '}});fireEvent.click(screen.getByRole('button',{name:'Add tag',exact:true}));expect(screen.getByRole('button',{name:'Remove tag Lunch'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Remove tag VIP'}));expect(screen.queryByRole('button',{name:'Remove tag VIP'})).toBeNull();});
 it('does not offer selected tags twice or allow duplicate creation',()=>{const onChange=vi.fn();render(<TagPicker value={['VIP']} options={['VIP','VIP']} onChange={onChange} allowCreate/>);fireEvent.click(screen.getByRole('button',{name:'Tags',exact:true}));expect(screen.queryByRole('option',{name:'VIP'})).toBeNull();fireEvent.change(screen.getByRole('textbox',{name:'New tag'}),{target:{value:' VIP '}});expect(screen.getByRole('button',{name:'Add tag',exact:true}).disabled).toBe(true);expect(onChange).not.toHaveBeenCalled();});
});
