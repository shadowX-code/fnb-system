import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Blocker from '../PayrollEmploymentHistoryRequired.jsx';
afterEach(cleanup);
const issue = 'employment_history_unresolved:2026-09-01..2026-09-28';
it('links only canonical unresolved records to the People employment surface', () => {
 render(<Blocker issue={issue} canEditEmployee employees={[{id:'missing',name:'Historical employee'},{id:'known',name:'Verified employee'}]}
  preparation={{results:[{employee_id:'missing',employment:{state:'review_required',issue}},{employee_id:'known',employment:{state:'resolved'}}]}} />);
 expect(screen.getByRole('link',{name:'Resolve Employment History for Historical employee'}).getAttribute('href')).toBe('/people/employees?employee=missing&section=employment');
 expect(screen.queryByText('Verified employee')).toBeNull();
 expect(screen.getByText(/2026-09-01 – 2026-09-28/)).toBeTruthy();
});
it('does not infer affected employees from the current employee list or unresolved run range', () => {
 render(<Blocker issue={issue} canEditEmployee employees={[{id:'current',name:'Current employee'}]} />);
 expect(screen.queryByRole('link')).toBeNull();
 expect(screen.getByText('Employment History Required')).toBeTruthy();
 expect(screen.getByText(/determine which employees belong/)).toBeTruthy();
});
it('does not offer correction without existing employee-edit permission', () => {
 render(<Blocker issue={issue} preparation={{results:[{employee_id:'missing',employment:{state:'review_required',issue}}]}} />);
 expect(screen.queryByRole('link')).toBeNull();
});
