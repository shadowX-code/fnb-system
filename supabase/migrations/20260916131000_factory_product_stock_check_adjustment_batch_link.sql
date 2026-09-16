-- New reconciliation batches retain their structured Stock Check item link so
-- read-only Stock Check detail can show the actual adjustment batch reference.
-- Historical rows are intentionally not backfilled or rewritten.

create or replace function public.factory_link_product_stock_check_adjustment_batch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_type = 'adjustment' and new.source_reference_id is not null then
    update public.factory_product_stock_check_items item
    set positive_adjustment_batch_balance_id = new.id,
        updated_at = now()
    where item.stock_check_id = new.source_reference_id
      and item.finished_good_id = new.finished_good_id
      and item.positive_adjustment_confirmed is true
      and item.positive_adjustment_batch_balance_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_link_product_stock_check_adjustment_batch_after_insert
  on public.factory_finished_good_batch_balances;
create trigger factory_link_product_stock_check_adjustment_batch_after_insert
after insert on public.factory_finished_good_batch_balances
for each row execute function public.factory_link_product_stock_check_adjustment_batch();

notify pgrst, 'reload schema';
