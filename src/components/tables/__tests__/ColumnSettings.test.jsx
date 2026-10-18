import {useState} from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import ColumnSettings from '../ColumnSettings.jsx';
afterEach(cleanup);
it('keeps required columns, changes optional visibility, resets and returns focus on Escape',async()=>{
 function Example(){const [value,setValue]=useState(['name','email','actions']);return <ColumnSettings columns={[{key:'name',label:'Name',required:true},{key:'email',label:'Email'},{key:'actions',label:'Actions',required:true}]} value={value} defaults={['name','actions']} onChange={setValue}/>}
 render(<Example/>);const trigger=screen.getByRole('button',{name:/Column Settings/});fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'Column Settings'})).toBeTruthy();expect(screen.getByLabelText('Name',{exact:false}).disabled).toBe(true);expect(screen.getByLabelText('Actions',{exact:false}).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('Email'));expect(trigger.textContent).toContain('2/3');
 fireEvent.click(screen.getByLabelText('Email'));fireEvent.click(screen.getByRole('button',{name:'Reset to Default'}));expect(screen.getByLabelText('Email').checked).toBe(false);
 fireEvent.keyDown(document,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(document.activeElement).toBe(trigger);
});
