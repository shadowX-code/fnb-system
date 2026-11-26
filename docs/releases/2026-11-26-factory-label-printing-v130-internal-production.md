# Factory Label Printing v1.3.0 internal Production release

Date: 2026-11-26

## Changes

- Release the isolated Factory candidate `693e5de746a93426a36ac55b5a021deb0ca1270e` from baseline `4ca36224f3908580f3a2a12eb71640b2570e2511`, including the reviewed Staging Printer Setup Wizard and silent polling.
- Deliver the approved Production installer files from a private Supabase bucket. Only active employees with the existing Factory Production Complete permission can download either allowlisted object. The policy only authorizes authenticated object downloads and their CDN metadata checks. Browser SHA-256 verification pins the approved artifact bytes before save.
- The owner accepted the unsigned Windows EXE and unsigned Mac PKG with ad-hoc app signature for controlled internal use. Commercial signing and notarization remain separate work. Keep installer bytes out of the public web root and preserve managed workstation security controls.

## Migration Impact

Apply these source migrations in order against the canonical Production Supabase project. Record their actual Production ledger entries. Earlier Label Printing migrations are already applied under their Production release versions.

1. `20261125135557_factory_print_bridge_setup_authority.sql`
2. `20261126033707_factory_label_internal_installer_storage.sql`
3. `20261126050618_factory_label_internal_installer_download_metadata.sql`

The update adds device rename and reservation authority, then installer-only Storage access. The forward policy change permits the metadata lookup observed during hosted CDN authorization. That lookup uses the same operator and file restrictions as the download. It leaves existing jobs, snapshots, business data, and permissions assignments intact. No Edge Function or external Gateway changes are required.

## Deployment Notes

- Verify the Production baseline and private bucket policy, upload the exact candidate artifacts, read both copies back, and compare the candidate SHA-256 digests.
- Confirm unauthorized HTTP reads fail while printing is gated. Set only the two Production printing flags immediately before the scoped fast-forward to main. Let Vercel Git Integration deploy and verify the exact SHA on the canonical Production host. If the enabled build cannot safely serve the feature, remove the Production flags and redeploy a known-good gated build using release governance.
- Use only the existing Production employee authorization flow. Confirm an authorized browser can download both files, unauthenticated callers cannot download them, and the Setup Wizard opens without registering or printing.
- On each receiving workstation, stop Staging workers on the shared printer before selecting it in Production. Verify native install or upgrade, reconnect, heartbeat, and fresh connection without physical printing. Existing Staging Bluetooth hardware acceptance remains the evidence for both platforms. A Production registration still requires its own calibration evidence before operational use.

See the [candidate verification and artifact hashes](2026-11-26-factory-label-printing-v130-candidate.md) and the [internal installation guide](../../tools/print-bridge/README.md).
