-- Preserve the original human helper volatility contract after shared-core extraction.
alter function public.factory_current_active_employee_id() stable;
alter function public.factory_current_active_employee_name() stable;
