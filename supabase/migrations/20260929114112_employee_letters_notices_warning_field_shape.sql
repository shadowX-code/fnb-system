-- The old nonempty checks were warning-only and reject NULL for receipt-only
-- letters. The new employee_letter_notice_content_shape constraint in the
-- preceding migration requires these fields for Warning and forbids them for
-- the other enabled types.
alter table public.employee_disciplinary_warnings
  drop constraint employee_disciplinary_warnings_warning_details_check,
  drop constraint employee_disciplinary_warnings_required_action_check;
