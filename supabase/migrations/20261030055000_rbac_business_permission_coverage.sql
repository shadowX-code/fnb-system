-- Trusted draft deletion retains its Edit authority and authenticated lifecycle.
revoke all on function public.factory_delete_product_stock_check_draft(uuid) from public,anon;
grant execute on function public.factory_delete_product_stock_check_draft(uuid) to authenticated;
