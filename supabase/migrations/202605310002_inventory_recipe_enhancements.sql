alter table public.inventory_recipes
add column if not exists recipe_photo_url text;

create table if not exists public.inventory_menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_menu_categories_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists inventory_menu_categories_name_unique
on public.inventory_menu_categories (lower(name));

create index if not exists inventory_menu_categories_status_idx
on public.inventory_menu_categories (status);

create index if not exists inventory_menu_categories_sort_idx
on public.inventory_menu_categories (sort_order);

grant select, insert, update, delete on table public.inventory_menu_categories to authenticated;
revoke all on table public.inventory_menu_categories from anon;

alter table public.inventory_menu_categories enable row level security;

drop policy if exists "inventory menu categories select" on public.inventory_menu_categories;
create policy "inventory menu categories select"
on public.inventory_menu_categories for select to authenticated
using (
  public.current_user_has_permission('inventory_recipes.view')
  or public.current_user_has_permission('inventory_recipes.manage')
  or public.current_user_has_permission('inventory_control.view')
);

drop policy if exists "inventory menu categories insert" on public.inventory_menu_categories;
create policy "inventory menu categories insert"
on public.inventory_menu_categories for insert to authenticated
with check (
  public.current_user_has_permission('inventory_recipes.manage')
  or public.current_user_has_permission('inventory_control.manage')
);

drop policy if exists "inventory menu categories update" on public.inventory_menu_categories;
create policy "inventory menu categories update"
on public.inventory_menu_categories for update to authenticated
using (
  public.current_user_has_permission('inventory_recipes.manage')
  or public.current_user_has_permission('inventory_control.manage')
)
with check (
  public.current_user_has_permission('inventory_recipes.manage')
  or public.current_user_has_permission('inventory_control.manage')
);

drop policy if exists "inventory menu categories delete" on public.inventory_menu_categories;
create policy "inventory menu categories delete"
on public.inventory_menu_categories for delete to authenticated
using (
  public.current_user_has_permission('inventory_recipes.manage')
  or public.current_user_has_permission('inventory_control.manage')
);

insert into public.inventory_menu_categories (name, sort_order)
values
  ('Main Dish', 1),
  ('Beverage', 2),
  ('Side Dish', 3),
  ('Sauce', 4),
  ('Dessert', 5),
  ('Prep Item', 6),
  ('Combo', 7),
  ('Other', 8)
on conflict ((lower(name))) do update
set sort_order = excluded.sort_order,
    updated_at = now();
