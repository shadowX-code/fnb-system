-- The established single-record checklist draft authority inserts base item
-- rows before crew_tasks_save enriches them with unified block semantics.
alter table public.crew_operation_template_items
  alter column block_type set default 'checklist_item';
