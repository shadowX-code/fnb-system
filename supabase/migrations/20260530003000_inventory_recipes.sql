create table if not exists public.inventory_recipes (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete set null,
  recipe_name text not null,
  menu_category text,
  serving_size numeric,
  status text not null default 'active',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.inventory_recipes(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  quantity_used numeric not null,
  unit text,
  wastage_percent numeric not null default 0,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_recipes_outlet_idx on public.inventory_recipes (outlet_id);
create index if not exists inventory_recipes_status_idx on public.inventory_recipes (status);
create index if not exists inventory_recipes_menu_category_idx on public.inventory_recipes (menu_category);
create index if not exists inventory_recipe_items_recipe_idx on public.inventory_recipe_items (recipe_id);
create index if not exists inventory_recipe_items_item_idx on public.inventory_recipe_items (inventory_item_id);

grant select, insert, update, delete on table public.inventory_recipes to authenticated;
grant select, insert, update, delete on table public.inventory_recipe_items to authenticated;
revoke all on table public.inventory_recipes from anon;
revoke all on table public.inventory_recipe_items from anon;

alter table public.inventory_recipes enable row level security;
alter table public.inventory_recipe_items enable row level security;

drop policy if exists "inventory recipes scoped select" on public.inventory_recipes;
create policy "inventory recipes scoped select"
on public.inventory_recipes for select to authenticated
using (
  (
    public.current_user_has_permission('inventory_recipes.view')
    or public.current_user_has_permission('inventory_recipes.manage')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory recipes scoped insert" on public.inventory_recipes;
create policy "inventory recipes scoped insert"
on public.inventory_recipes for insert to authenticated
with check (
  (
    public.current_user_has_permission('inventory_recipes.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory recipes scoped update" on public.inventory_recipes;
create policy "inventory recipes scoped update"
on public.inventory_recipes for update to authenticated
using (
  (
    public.current_user_has_permission('inventory_recipes.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_recipes.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory recipes scoped delete" on public.inventory_recipes;
create policy "inventory recipes scoped delete"
on public.inventory_recipes for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_recipes.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory recipe items scoped select" on public.inventory_recipe_items;
create policy "inventory recipe items scoped select"
on public.inventory_recipe_items for select to authenticated
using (
  exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = inventory_recipe_items.recipe_id
      and (
        public.current_user_has_permission('inventory_recipes.view')
        or public.current_user_has_permission('inventory_recipes.manage')
        or public.current_user_has_permission('inventory_control.view')
      )
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
);

drop policy if exists "inventory recipe items scoped insert" on public.inventory_recipe_items;
create policy "inventory recipe items scoped insert"
on public.inventory_recipe_items for insert to authenticated
with check (
  exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = inventory_recipe_items.recipe_id
      and (
        public.current_user_has_permission('inventory_recipes.manage')
        or public.current_user_has_permission('inventory_control.manage')
      )
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
);

drop policy if exists "inventory recipe items scoped update" on public.inventory_recipe_items;
create policy "inventory recipe items scoped update"
on public.inventory_recipe_items for update to authenticated
using (
  exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = inventory_recipe_items.recipe_id
      and (
        public.current_user_has_permission('inventory_recipes.manage')
        or public.current_user_has_permission('inventory_control.manage')
      )
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
)
with check (
  exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = inventory_recipe_items.recipe_id
      and (
        public.current_user_has_permission('inventory_recipes.manage')
        or public.current_user_has_permission('inventory_control.manage')
      )
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
);

drop policy if exists "inventory recipe items scoped delete" on public.inventory_recipe_items;
create policy "inventory recipe items scoped delete"
on public.inventory_recipe_items for delete to authenticated
using (
  exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = inventory_recipe_items.recipe_id
      and (
        public.current_user_has_permission('inventory_recipes.manage')
        or public.current_user_has_permission('inventory_control.manage')
      )
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
);
