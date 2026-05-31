create table if not exists public.product_recipe_mappings (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  product_name text not null,
  recipe_id uuid not null references public.inventory_recipes(id) on delete cascade,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_recipe_mappings_outlet_product_unique
on public.product_recipe_mappings (outlet_id, lower(product_name));

create index if not exists product_recipe_mappings_recipe_idx
on public.product_recipe_mappings (recipe_id);

grant select, insert, update, delete on table public.product_recipe_mappings to authenticated;
revoke all on table public.product_recipe_mappings from anon;

alter table public.product_recipe_mappings enable row level security;

drop policy if exists "product recipe mappings scoped select" on public.product_recipe_mappings;
create policy "product recipe mappings scoped select"
on public.product_recipe_mappings for select to authenticated
using (
  (public.current_user_has_permission('inventory_recipes.view') or public.current_user_has_permission('inventory_recipes.manage'))
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings scoped insert" on public.product_recipe_mappings;
create policy "product recipe mappings scoped insert"
on public.product_recipe_mappings for insert to authenticated
with check (
  public.current_user_has_permission('inventory_recipes.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings scoped update" on public.product_recipe_mappings;
create policy "product recipe mappings scoped update"
on public.product_recipe_mappings for update to authenticated
using (
  public.current_user_has_permission('inventory_recipes.manage')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('inventory_recipes.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings scoped delete" on public.product_recipe_mappings;
create policy "product recipe mappings scoped delete"
on public.product_recipe_mappings for delete to authenticated
using (
  public.current_user_has_permission('inventory_recipes.manage')
  and public.current_user_can_access_outlet(outlet_id)
);
