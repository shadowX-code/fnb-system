import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import AdminPagination from '../../tables/AdminPagination.jsx';
afterEach(cleanup);
it('uses a container-safe compact pager with the same canonical paging callbacks',()=>{
 const onPageChange=vi.fn(),onPageSizeChange=vi.fn();
 render(<AdminPagination compact page={2} pageSize={20} total={100} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange}/>);
 expect(screen.getByLabelText('Page 2 of 5')).toBeTruthy();
 expect(screen.getAllByRole('button',{name:'Next',exact:true})).toHaveLength(1);
 expect(screen.getByRole('button',{name:'Rows per page'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Next',exact:true}));expect(onPageChange).toHaveBeenCalledWith(3);
 fireEvent.click(screen.getByRole('button',{name:'Previous',exact:true}));expect(onPageChange).toHaveBeenCalledWith(1);
});
