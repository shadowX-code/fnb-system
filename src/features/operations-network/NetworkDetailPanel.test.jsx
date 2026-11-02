import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import NetworkDetailPanel from './NetworkDetailPanel.jsx';
afterEach(cleanup);
it('shows explicit unavailable step evidence instead of fabricating an execution trace',()=>{
  render(<NetworkDetailPanel node={{id:'agent:a',data:{kind:'agent',label:'Actual agent',status:'observed',moduleIds:[]}}} events={[]} modules={[]} onClose={vi.fn()} onNavigate={vi.fn()} onToggle={vi.fn()} onSelect={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Execution',exact:true}));
  expect(screen.getByText(/Step-level execution trace unavailable/)).toBeTruthy();
  expect(screen.queryByText(/Success Rate/)).toBeNull();
  expect(screen.queryByText(/Live Run/)).toBeNull();
});
