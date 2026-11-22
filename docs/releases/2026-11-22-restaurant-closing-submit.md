# Restaurant Submit & Publish Closing

Date: 22 November 2026 (MYT)

## Changes

- Authorized Admin submission publishes Closing Stock for the selected outlet and month in the same transaction. Crew can save a draft for Admin submission.
- Closing updates append a linked revision and retain submitted evidence and pinned costs. Partial values continue to appear below EBITDA.

## Migration Impact

Apply `20261122153408_restaurant_closing_submit_publication.sql`. This migration changes the publication command and closing evidence constraint. Historical audit rows and publications are preserved.

## Deployment Notes

Use the governed main-branch Vercel deployment. Open tabs must reload for the updated actions. During cutover, older clients cannot submit or publish a closing through their previous flow. HLIPH October 2026 remains a separate authorized publication action.
