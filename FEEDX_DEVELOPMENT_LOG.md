# FeedX Development Log

Purpose: concise development history for meaningful FeedX development sessions. The master document remains the source of truth for final logic and architecture; release notes under `docs/releases/` document production releases.

## 2026-05-22

### People
- Stabilized Employees, Job Positions, Departments, Roles & Permissions, and Employee Login Access.
- Separated Employment Type, Employment Status, and System Access.
- Added Management workplace option for HQ/non-outlet staff.

### Duty Roster
- Stabilized roster settings, shift templates, outlet staff filtering, and time input UX.
- Kept resigned/terminated employees out of outlet-specific roster staff selection.

## 2026-05-24

### Asset Tracking
- Stabilized asset records, import workflow, inspections, activity display, and actor-name resolution.
- Simplified inspection UX to Setup, Checklist, and Review & Submit.

## 2026-05-26

### Inventory Control
- Completed persistence hardening for Master Inventory, Categories, UOM, Par Levels, Stock Check Groups, Stock Checks, Purchase Suggestions, Purchase Orders, Inventory Movements, Wastage, and Recipes.
- Removed local-only operational persistence paths from active Inventory Control modules.
- Added UAT and production-readiness documentation for Inventory workflows.

## 2026-05-28

### Recipes & Usage
- Added recipe costing foundation with recipe code, English/Chinese names, ingredient costs, selling price, margin, and recipe photos.
- Added Product Mapping workflow for Product Analytics products to recipes.

### Recipe Intelligence
- Added standalone Recipe Intelligence analytics page.
- Added mapping health, menu engineering matrix, gross profit trend, ingredient demand forecast, ingredient consumption, and ingredient cost trend foundations.

## 2026-05-30

### UI
- Standardized KPI typography, table density, sidebar typography, dark-mode semantic colors, and operational KPI card headers.
- Renamed Waste & Variance to Wastage and Purchase Categories to Supplier Categories in UI/navigation.

## 2026-06-01

### Production
- Completed Production readiness audit, production UAT checklist, and release-candidate reporting.
- Reset Production Supabase after approved disposable-data decision.
- Achieved migration parity 67/67 after Production reset.
- Removed migration-seeded test inventory rows from Production.
- Bootstrapped first Production owner user.

### Auth
- Audited Production SMTP readiness.
- Confirmed SMTP/setup email delivery was blocked pending configuration.
- Fixed Generate Setup Link Supabase v2 admin-client insert/update/upsert handling.

## 2026-06-02

### Production Operations
- Entered Production Operations Phase.
- Confirmed development governance: all development on `dev`, Production deploys from `main`, schema changes are migration-based, and Production Supabase changes require explicit approval.

### Auth UI
- Refreshed public login/setup/reset visual system with dark futuristic Holographic Ring direction.
- Removed dashboard mockup, bottom logo bar, duplicate auth-card logo, and unsupported SSO-style visual clutter.
- Refined the auth hero visual to use `public/holographic-ring.webp` as the central image asset with green glow, dark edge masking, reduced red/magenta artifacts, and subtle particle/pulse motion.

### UI
- Replaced the sidebar brand icon with the new `public/logo-icon.jpg` asset while preserving FeedX wordmark, subtitle, spacing, and layout.
