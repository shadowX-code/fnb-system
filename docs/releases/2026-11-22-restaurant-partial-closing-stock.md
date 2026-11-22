# Restaurant Month-End Closing Stock

Date: 22 November 2026 (MYT)

## Changes

- Review Closing discloses the actual count date and the selected Closing Month. An authorized approver explicitly confirms the attribution.
- Partial Closing Stock uses the submitted quantities and their valid pinned costs. The published reference includes valuation coverage and the actual count date. Outlet P&L displays it below EBITDA.
- The release includes the simplified Audit Result and existing partial valuation coverage. Submitted count evidence, earlier closing revisions and financial calculations retain their existing authority.

## Migration Impact

Apply `20261122141501_restaurant_partial_closing_publication.sql` to the Production Supabase project. The migration adds publication fields and updates the existing approval and scoped reporting contracts. It leaves historical data intact.

## Deployment Notes

Use the governed main-branch Vercel deployment. Open tabs require a reload for the revised approval form. Historical closing confirmation remains an action for an authorized approver.
