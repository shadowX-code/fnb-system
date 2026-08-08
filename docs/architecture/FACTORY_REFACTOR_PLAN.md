# Factory Refactor Plan

Priority: P1 maintainability. This is a planning record only; no behavior change is required now.

## Current Shape

- `src/features/factory/pages/FactoryWorkspacePage.jsx` is approximately 13.7k lines.
- `src/services/factoryService.js` is approximately 4k lines.

## Future Extraction Boundaries

- `pages/`: route-specific Factory views.
- `components/`: shared tables, filters, status displays, and page sections.
- `modals/`: Job Order, Production, Receiving, Dispatch, Stock Check, Recipe, SOP, and traceability dialogs.
- `hooks/`: paginated loading, stale-response protection, permission clearing, mutation-refresh contracts, and batch allocation state.
- `utils/`: Malaysia date handling, formatters, status labels, business-reference display, and allocation calculations.

Each extraction should preserve permission gates, authoritative RPC usage, refresh/error behavior, and existing user workflows. No Factory business logic, migration, or permission refactor belongs in this plan.
