alter table public.factory_label_devices add column name_managed boolean not null default false;

create table public.factory_label_bluetooth_leases (
  device_id uuid primary key references public.factory_label_devices(id) on delete cascade,
  printer_key text not null,
  lease_until timestamptz not null
);
create index factory_label_bluetooth_printer_idx on public.factory_label_bluetooth_leases (printer_key);
alter table public.factory_label_bluetooth_leases enable row level security;
revoke all on public.factory_label_bluetooth_leases from public,anon,authenticated;

create or replace function public.factory_label_device(p_device uuid,p_name text,p_printer text,p_transport text,p_status text,p_printers jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.factory_label_actor('factory_production.complete');
 if length(btrim(p_name)) not between 1 and 100 or length(btrim(p_printer)) not between 1 and 200 or p_transport not in ('spooler','tspl') or length(p_printers::text)>20000 or p_status not in ('Ready','Offline','Error') then raise exception 'Invalid bridge configuration.'; end if;
 insert into public.factory_label_devices(id,owner,name,printer_name,transport,status,printers,last_reported_calibration) values(p_device,auth.uid(),p_name,p_printer,p_transport,p_status,p_printers,public.factory_label_reported_calibration(p_printers,p_printer))
 on conflict(id) do update set name=case when factory_label_devices.name_managed then factory_label_devices.name else excluded.name end,printer_name=excluded.printer_name,transport=excluded.transport,status=excluded.status,printers=excluded.printers,last_seen=now(),
 last_reported_calibration=coalesce(excluded.last_reported_calibration,case
   when factory_label_devices.printer_name=excluded.printer_name and factory_label_devices.transport=excluded.transport
   then coalesce(factory_label_devices.last_reported_calibration,public.factory_label_reported_calibration(factory_label_devices.printers,factory_label_devices.printer_name))
 end)
 where factory_label_devices.owner=auth.uid() and factory_label_devices.enabled;
 if not found then raise exception using errcode='42501',message='Bridge is disabled or belongs to another operator.'; end if;
 return jsonb_build_object('id',p_device);
end $$;

create function public.factory_label_rename_device(p_device uuid,p_name text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=public.factory_label_actor('factory_finished_goods.edit');
  v_before text;
  v_name text:=btrim(coalesce(p_name,''));
begin
  if length(v_name) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Enter a device name of 1 to 100 characters.';
  end if;
  select name into v_before from public.factory_label_devices where id=p_device for update;
  if not found then raise exception 'Print bridge unavailable.'; end if;
  if v_before=v_name then return; end if;
  update public.factory_label_devices set name=v_name,name_managed=true where id=p_device;
  insert into public.factory_label_management_events(entity_key,action,detail,actor)
  values(p_device::text,'bridge_rename',jsonb_build_object('previous_name',v_before,'name',v_name),v_actor);
end $$;

create function public.factory_label_bluetooth_lease(p_device uuid,p_printer_key text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.factory_label_actor('factory_production.complete');
  if p_printer_key is null or p_printer_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Select a paired Bluetooth printer.';
  end if;
  perform 1 from public.factory_label_devices
    where id=p_device and owner=auth.uid() and enabled and transport='tspl' for update;
  if not found then raise exception using errcode='42501',message='An authorized Bluetooth bridge is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('factory-label-bluetooth:'||p_printer_key,0));
  if exists(select 1 from public.factory_label_bluetooth_leases
    where device_id<>p_device and printer_key=p_printer_key and lease_until>now()) then
    return false;
  end if;
  insert into public.factory_label_bluetooth_leases(device_id,printer_key,lease_until)
  values(p_device,p_printer_key,now()+interval '120 seconds')
  on conflict(device_id) do update set printer_key=excluded.printer_key,lease_until=excluded.lease_until;
  return true;
end $$;

revoke all on function public.factory_label_rename_device(uuid,text),
  public.factory_label_bluetooth_lease(uuid,text) from public,anon,authenticated;
grant execute on function public.factory_label_rename_device(uuid,text),
  public.factory_label_bluetooth_lease(uuid,text) to authenticated;
