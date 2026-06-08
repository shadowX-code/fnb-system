-- Duty Roster published snapshot retention
-- Published roster history must remain readable even after employee master data changes.

alter table public.duty_rosters
  add column if not exists employee_name_snapshot text,
  add column if not exists position_snapshot text,
  add column if not exists department_snapshot text,
  add column if not exists outlet_snapshot text,
  add column if not exists shift_snapshot jsonb,
  add column if not exists publish_timestamp timestamptz;

create index if not exists duty_rosters_publish_timestamp_idx
  on public.duty_rosters (publish_timestamp)
  where publish_timestamp is not null;

create index if not exists duty_rosters_status_date_idx
  on public.duty_rosters (status, roster_date);

comment on column public.duty_rosters.employee_name_snapshot is
  'Published roster employee display name retained for historical duty roster viewing.';

comment on column public.duty_rosters.position_snapshot is
  'Published roster employee position retained for historical duty roster viewing.';

comment on column public.duty_rosters.department_snapshot is
  'Published roster employee department retained for historical duty roster viewing.';

comment on column public.duty_rosters.outlet_snapshot is
  'Published roster outlet display name retained for historical duty roster viewing.';

comment on column public.duty_rosters.shift_snapshot is
  'Published roster shift template/time snapshot retained for historical duty roster viewing.';

comment on column public.duty_rosters.publish_timestamp is
  'Timestamp when this duty roster row was last published as a historical snapshot.';
