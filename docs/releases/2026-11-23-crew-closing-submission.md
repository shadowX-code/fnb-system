# Crew Month-End Closing submission

Date: 23 November 2026 (MYT)

## Changes

Crew Confirm submits a complete count and opens the submitted result. Review shows Master Inventory thumbnails. An authorized Admin can publish the submitted evidence through the existing Audit Result action.

## Migration Impact

Apply `20261123043604_restaurant_crew_closing_submission.sql`. It updates the shared Stock Check save wrapper and performs no backfill or submission.

## Deployment Notes

Apply the migration before the governed main-branch deploy. Verify Crew and Admin read-only after Vercel is READY. Leave the existing HLIPH September draft and all Closing Stock publications untouched during deployment.
