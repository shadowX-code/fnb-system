# EBITDA Terminology Release

Date: 2026-09-14

## Changes

- Standardized the management P&L display vocabulary to EBITDA and EBITDA Margin across Outlet P&L and Reports.
- Renamed the user-facing Monthly Profit report to Monthly P&L, including poster and export filenames.
- Preserved the existing `netProfit` contract fields and financial calculations.

## Migration Impact

None. Production already contained the required Reporting migrations; this release is display terminology only.

## Deployment Notes

- Released through canonical `main` to the `fnb-system` Production project.
- Authenticated Production QA covered Outlet P&L, Monthly P&L, Yearly P&L, and fresh PNG/PDF exports.
