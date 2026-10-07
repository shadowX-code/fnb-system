-- Presentation metadata only. Do not change codes, IDs, grants or scope.
update public.permissions
set description = case code
  when 'crew_leave_settings.manage' then 'Configure outlet-scoped leave policies and their effective history.'
  when 'factory_petty_cash.manage' then 'Configure Factory Petty Cash categories.'
end
where code in ('crew_leave_settings.manage', 'factory_petty_cash.manage');
