-- Allow authorized Petty Cash writers to remove only receipt objects that are
-- no longer referenced by any ledger row. Posted evidence therefore remains
-- immutable while failed uploads, Draft replacements and Draft deletions can
-- clean their private Storage objects through the canonical Storage API.

create or replace function public.factory_petty_cash_receipt_can_delete(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and public.current_user_has_permission('factory_petty_cash.create')
    and not exists (
      select 1
      from public.factory_petty_cash_transactions transaction
      where transaction.receipt_path = p_path
    );
$$;

revoke execute on function public.factory_petty_cash_receipt_can_delete(text) from public, anon;
grant execute on function public.factory_petty_cash_receipt_can_delete(text) to authenticated;

create policy "factory petty cash unreferenced receipt cleanup"
on storage.objects for delete to authenticated
using (
  bucket_id = 'factory-petty-cash-receipts'
  and public.factory_petty_cash_receipt_can_delete(name)
);
