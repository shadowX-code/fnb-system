-- Pin the configured Master Inventory unit cost when an Audit is submitted.
-- Older submitted evidence is deliberately left null: its historical cost is
-- not recoverable from today's mutable item master.
alter table public.inventory_stock_check_items
  add column unit_cost_snapshot numeric(12,4)
  constraint inventory_stock_check_items_cost_snapshot_nonnegative
  check (unit_cost_snapshot >= 0);

create function inventory_authority.snapshot_submitted_audit_cost()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'draft' and new.status = 'submitted' and new.stock_check_type = 'audit' then
    update public.inventory_stock_check_items check_item
    set unit_cost_snapshot = case
      when item.cost_updated_at is not null
        and item.cost is not null
        and item.cost >= 0
        and lower(trim(check_item.unit)) = lower(trim(item.unit))
      then item.cost
      else null
    end
    from public.inventory_items item
    where check_item.stock_check_id = new.id and check_item.item_id = item.id;
  end if;
  return new;
end; $$;

create trigger inventory_snapshot_submitted_audit_cost
  before update of status on public.inventory_stock_checks
  for each row execute function inventory_authority.snapshot_submitted_audit_cost();
