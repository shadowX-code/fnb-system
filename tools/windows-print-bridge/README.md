# FeedX Windows Print Bridge — Staging

Windows 10/11, Windows PowerShell 5.1 and .NET Framework (included with Windows) are required. No Labelife or inbound network port is used. The current Windows user must remain signed in; a locked screen is fine. The per-user scheduled task starts at sign-in and runs without administrator privileges.

1. Pair the D520 in Windows Bluetooth settings and install its vendor Windows printer driver. Print the Windows test page. FeedX discovers installed Windows queues; it does not pair Bluetooth devices.
2. Extract this complete package to a local folder. Review the scripts and run `powershell.exe -NoProfile -File .\Install-Bridge.ps1`. If Windows marks the downloaded files as blocked, review them and use Properties → Unblock (or `Get-ChildItem . -Recurse | Unblock-File`). Follow your organization’s PowerShell signing policy; the package does not bypass it.
3. Select the exact Windows queue name. Enter the **Staging public publishable/anon key**, never a service key, and sign in with an active FeedX Staging employee account with `factory_production.complete`. The endpoint is fixed to `ujkzdaaadnvcfayuldmh.supabase.co`; Production endpoints are not configurable.
4. In FeedX **Factory Settings → Label Management → Product Labels**, open the existing Packaging SKU’s **Label Editor** (Finished Goods retains a shortcut to the same editor). Review all product, regulatory and static template content. Supply approved storage instructions, shelf life/rule, net weight and approval reason. Save a Draft, review the canonical preview, then Approve & Publish a new version with a reason. Publishing requires explicit content approval and `factory_finished_goods.edit`. Drafts do not affect printing. Shared layouts are managed separately in Templates; existing SKU assignments stay pinned until explicitly reassigned and approved.
5. Open completed Job Order → **Print Labels**, select its actual completed batch and registered bridge, inspect the preview, and confirm label quantity. Print one calibration label first. Each original label consumes the recorded packaged-unit allowance, even if its outcome later fails. Subsequent recovery is an audited reprint.
6. Configure the printer driver for the exact 80×90 mm media, 203 DPI, no scaling and appropriate gap sensing. Measure the paper output. FeedX refuses a driver printable area smaller than the label. Any vendor driver rounding, orientation, margins, gap and Bluetooth behavior require hardware calibration.

## Security and local operation

Only outbound HTTPS is used. The operator password is used once to sign in and is not saved. Session/refresh credentials and the interruption journal use Windows user-bound DPAPI with atomic writes under `%LOCALAPPDATA%\FeedXPrintBridge`; installer ACLs restrict the directory to the user and SYSTEM. No tokens or HTTP response bodies are logged. The non-secret public key and queue settings are in `config.json`. Use a dedicated least-privileged employee account where operationally appropriate; this is normal FeedX Auth, with permissions and active employment checked on every RPC. Disable the employee’s access through the existing identity workflow to revoke bridge authority.

If sign-in expires or changes, run the installer again with the same Windows user. It preserves device identity and the interruption journal. Do not copy session files between users/computers. Check Task Scheduler → **FeedX Print Bridge Staging**, Windows print queue, `%LOCALAPPDATA%\FeedXPrintBridge\status.txt`, and FeedX print history when troubleshooting. Stop the scheduled task before editing `config.json`.

## Delivery and recovery semantics

- **Queued**: saved in FeedX; offline printers do not claim new work.
- **Printing**: exclusively claimed by one bridge (10-minute lease); the local journal is flushed before any native printer call.
- **Sent**: the driver/RAW spooler accepted the submission. This is **not physical proof**.
- **Confirmed**: a supervisor with `factory_production.verify` inspected the physical output and recorded a reason.
- **Failed**: no submission occurred, or an operator inspected/cancelled/discarded remaining output and recorded the outcome.
- **Unknown**: timeout, interruption, native transport error or expired claim. No automatic resend. An Unknown job blocks that bridge’s next claim until a supervisor records the outcome.

After a crash, an in-progress submission is reported Unknown; a saved result is retried only as a status report. Claim/result HTTP retries reuse stable claim IDs. The bridge never automatically submits a bitmap twice. A network partition can leave a pending report; restore connectivity and inspect history. On lease expiry, Printing becomes Unknown on the next online claim. A supervisor may also mark an expired Printing claim Unknown through Review Outcome.

Before reprinting Unknown/Sent work, stop and clear any held Windows spooler job and inspect/discard partial labels. FeedX cannot recall commands already accepted by a printer. Record a reason, then use **Reprint**; it copies the original immutable snapshot and pixels. A physically partial batch requires an explicit remaining quantity. Never delete `journal.xml` to force a retry.

## Replaceable transports

Default `spooler` uses .NET `PrintDocument` and the vendor Windows driver. `tspl` sends a bounded bitmap TSPL command through `WritePrinter` RAW to the same queue: install using `-Transport tspl` only after verifying the D520 firmware and driver accept uncompressed TSPL BITMAP. All Chinese, logos, QR and barcode content is rasterized by FeedX, avoiding printer font dependencies. `TsplInvert` defaults true (TSPL zero-bit = dark); `GapMm` defaults 2 and must match actual stock. Both are local calibration values. No untrusted cloud TSPL, shell commands or remote URLs are executed. Future transports belong in `Transport.cs` with the same exclusive claim/journal protocol.

**Pending physical D520 checks:** actual Bluetooth queue availability and reconnect behavior, driver support on Windows 10 and 11, exact DPI/paper orientation/hard margins, gap calibration, RAW TSPL capability and bitmap polarity, long bulk jobs, paper-out recovery, Chinese legibility, QR/barcode scanner readability and physical output count. A BLE-only D520 without a usable Windows queue requires a vendor-specific transport implementation; it cannot be assumed TSPL-compatible. Software simulation does not establish hardware compatibility.

## Remove

Run `powershell.exe -NoProfile -File .\Install-Bridge.ps1 -Uninstall`. It removes the scheduled task and stored sign-in. It preserves files and the interrupted-job journal for inspection. Resolve any in-flight jobs in FeedX before deleting the remaining folder.

## Layout format

A reusable template is `{ "elements": [...] }`. Each element has millimetre `x,y,w,h`; text additionally has `size`, optional `bold`, `align`, `prefix`, `suffix`, `date_format:"dd/MM/yyyy"` and either `field` or static `text`. Fields: `product_name`, `product_name_cn`, `product_name_bm`, `product_code`, `variant_name`, `net_weight`, `storage_instructions`, `ingredients`, `manufacturer_name`, `manufacturer_address`, `manufacturing_date`, `expiry_date`, `batch_no`, `packaged_units`. The last four are read-only Production fields; label content cannot override them. Supported types: `text`, `rect` (optional `radius,stroke`), `line`, `qr`, `barcode` (Code 39), `image` (embedded PNG `src`). QR uses M correction and quiet zones; QR/barcode require at least two dots per module. All text must fit; FeedX refuses overflow. Freeze approved logo pixels as embedded PNGs. The screenshot’s certification seal has deliberately not been copied as approved artwork.
