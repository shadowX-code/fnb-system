-- Serialize deactivation with new work; continue existing schedules, sync and spend-reducing management.
create or replace function marketing_private.guard_active_brand_new_work() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='platform_customer_brands' then if exists(select 1 from public.platform_customer_brands where brand_id=new.brand_id and customer_id=new.customer_id) then return new;end if;end if;
 if tg_table_name='marketing_whatsapp_senders' then if exists(select 1 from public.marketing_whatsapp_senders where brand_id=new.brand_id and phone_e164=new.phone_e164) then return new;end if;end if;
 if tg_table_name='ads_changes' then if new.operation<>'create' then return new;end if;end if;
 perform 1 from public.brands where id=new.brand_id and is_active for share;
 if not found then raise exception 'This Brand is inactive. Reactivate it before starting new work.';end if;
 return new;
end;$$;
create or replace function marketing_private.guard_active_brand_schedule() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='scheduled' and (old.status<>'scheduled' or new.scheduled_at is distinct from old.scheduled_at) then
 perform 1 from public.brands where id=new.brand_id and is_active for share;
 if not found then raise exception 'This Brand is inactive. Existing schedules remain; new scheduling requires reactivation.';end if;end if;return new;
end;$$;
create trigger active_brand_new_work before insert on public.marketing_audiences for each row execute function marketing_private.guard_active_brand_new_work();
create trigger active_brand_new_work before insert on marketing_private.ads_changes for each row execute function marketing_private.guard_active_brand_new_work();
