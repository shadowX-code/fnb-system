-- Preserve permission codes/role grants while updating their displayed scope.
update public.permissions set description='View employee Letters & Notices and private supporting evidence'
where code='employee_disciplinary.view';
update public.permissions set description='Create, issue and manage employee Letters & Notices'
where code='employee_disciplinary.manage';
