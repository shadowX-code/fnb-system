-- Core dependency baseline
-- This migration intentionally runs before the RBAC migrations so a fresh
-- project can create foreign keys in dependency order.
--
-- Keep this file non-destructive. Later migrations add the full production
-- columns, indexes, grants, RLS policies, and seed data.

create extension if not exists pgcrypto;

create table if not exists public.outlets (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.purchase_categories (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid()
);
