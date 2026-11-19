-- Keep gateway discovery in step with the canonical Batch No. row projection.
update feedx_integrations.resources
set filter_fields = filter_fields - 'production_no'
where key = 'factory.production_records';

update feedx_integrations.resources
set relationship_fields = relationship_fields || '{"production_id":"production_records"}'::jsonb
where key in ('factory.product_movements', 'factory.raw_movements');

-- Label Management is a human Admin route and exports no agent resource.
update feedx_integrations.navigation_modules
set sort_order = sort_order + 1
where workspace = 'Factory' and sort_order >= 30;
insert into feedx_integrations.navigation_modules
  (id, workspace, section, label, route, sidebar, coverage, explanation, sort_order, capability_limitation, human_permission)
values
  ('factory_label_management', 'Factory', 'Settings', 'Label Management',
   '/factory/settings/labels', true, 'unavailable',
   'Label templates, devices, print jobs and recovery evidence have no external agent access.',
   30, 'Printer setup and label administration are available only to authorized Admin users.',
   'factory_finished_goods.view');
