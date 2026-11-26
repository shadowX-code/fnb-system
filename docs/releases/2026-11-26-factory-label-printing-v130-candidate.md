# Factory Label Printing 1.3.0 Production candidate

Branch `codex/factory-label-printing-v1.3.0-production-rc` isolates the Label Printing update from Production baseline `4ca36224f3908580f3a2a12eb71640b2570e2511`. The reviewed Staging source is `c4991d2d8e09e49bad4db44c93dfcf9a853e6676`.

## Exact application and database scope

- Printer Setup Wizard and silent status polling from the reviewed Staging source. Preserve Production installer links, custom URI, and the canonical Production feature gate. Use the existing Production select control.
- Printer Management device names and version reporting, plus Job Order Print History's confirmed usable counts and transport-specific recovery guidance.
- Native Windows and macOS 1.3.0 Bridge source, browser authorization, local setup windows, installer builds and native CI checks. Windows retains the driver queue and compatible RAW paths. macOS retains CUPS. Both carry the accepted D520 Bluetooth Classic path.
- One forward migration, `20261125135557_factory_print_bridge_setup_authority.sql`. It adds managed device names, audited rename, and the Bluetooth reservation authority. Preserve existing Label Printing RPCs, template and snapshot history, print-job lifecycle, and Factory inventory authorities. The 13 earlier Production label migrations already exist under their Production ledger versions. The earlier Staging filename ending `135552` is superseded by the applied `135557` entry.
- No new Edge Function, Gateway change, dependency upgrade, hosted installer binary, or unrelated Staging change. The existing configuration endpoint stays gated and unchanged.

Production's schema prerequisites and dormant state were checked read-only. There were no registered Production label devices, jobs, or snapshots. A local PostgreSQL rehearsal using the prerequisite migration definitions and fixture authentication exercised transaction rollback, existing device preservation, audited rename, calibration retention, role and owner boundaries, reservation exclusion and expiry. It made no live database changes.

## Evidence retained

- Canonical Staging already verified the Wizard layout and live polling. The candidate reran the focused label, gate, and pagination suite on its Production baseline.
- [GitHub Actions run 45629571584](https://github.com/shadowX-code/fnb-system/actions/runs/45629571584) passed native Windows and macOS software, installation, and upgrade-preservation checks for the Staging 1.3.0 packages. Existing macOS D520 physical tests passed. Staging Windows jobs `b0cdcd07` and `2a12b094` were rechecked read-only and remain Confirmed for one and three labels, with original audit evidence.
- Production endpoint returned HTTP 404. Neither Label Printing flag is configured in the Production Vercel project. These flags govern the web workflow and bootstrap endpoint. The existing permissioned database RPCs remain independently authorized.
- Both Production review installers were built outside hosted downloads. The Mac app and worker passed packaged self-tests. Windows had no PE signature. The Mac package was unsigned and the nested app signature was ad hoc. The final signed payloads still need native verification of identity, policy, clean install, upgrade, browser sign-in, and reconnect.

## Review artifact digests

| Private review file | SHA-256 |
| --- | --- |
| `FeedX-Print-Bridge-Production-Windows.exe` | `891145ec85652ccacec16bb58eecb1353cd17b2342dc46a76985ecdf4199263c` |
| `FeedX-Print-Bridge-Production-macOS-arm64.pkg` | `a17b847e21d193988cbed2f88786bc7f85e4f67dd433f3929e958eed67d48836` |

## Release hold

FeedX's owner must authorize a Windows publisher signing identity and Apple's Developer ID Application, Developer ID Installer, and notarization access. Keep release keys in an approved signing service or secured signing environment. Follow the [Print Bridge release guide](../../tools/print-bridge/README.md) for native verification and signed distribution. Obtain separate authorization before applying the migration, deploying Production, or enabling the flags. When a D520 moves between Staging and Production, stop its other environment's Bridge first because reservations are project-scoped.
