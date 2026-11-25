# FeedX Windows Print Bridge — Staging

## D520 Bluetooth Classic on Staging

Pair a powered D520 in **Windows Bluetooth settings** and close Labelife or other printer apps. Open **FeedX Print Bridge Staging → Connect / Configure** and choose **D520 Bluetooth**, then select the paired printer, label dimensions and actual gap. **Connection Check** requests a fresh worker observation of the Serial Port service and bitmap mode 4. A paired entry alone does not prove a usable connection. This route uses Windows Winsock RFCOMM with the Serial Port service UUID. It requires neither a printer queue nor a virtual COM port. BLE-only, Labelife-only and unverified firmware modes are outside this adapter.

The Windows Driver USB queue and compatible RAW TSPL queues remain available. Direct printing uses the same mode 4 literal LZO payload, polarity and feed direction as the macOS D520. An absent or negative acknowledgment leaves the attempt uncertain. Connection checks and print submissions share one channel lock. The worker checks a healthy connection at 60-second intervals and backs off failed checks at 15, 30 and 60 seconds. Connection status expires after 90 seconds and does not erase calibration. A manual request is handled by the worker. Keep Windows setup and physical approval separate. Windows Bluetooth hardware acceptance is still pending.

## First D520 hardware acceptance on Staging (USB)

Bring a Windows 10/11 computer, the D520 and its power supply, a USB data cable, 80 × 90 mm gap stock, and an active FeedX Staging operator account allowed to complete Production. Install the vendor driver for your Windows architecture and confirm the D520 appears in **Windows Printers & scanners**. Set the queue’s media to **80 × 90 mm, portrait, gap stock**. Use the vendor-documented USB path for the first test. [D520 vendor setup guide](https://omezizy.com/pages/d520-setup-guide)

1. Download [FeedX Print Bridge Staging for Windows](https://fnb-system-staging.vercel.app/downloads/FeedX-Print-Bridge-Staging-Windows.exe) on the printer computer. This unsigned Staging test package requires a Windows computer whose software policy permits it. Open the app from Start.
2. Choose **Connect / Configure** and sign in with the authorized Staging account. Select the exact D520 Windows queue, choose **Windows Driver**, and enter **80 × 90 mm**.
3. Run **Connection Check**. In Staging **Factory Settings → Label Management → Printers**, locate the registered computer with a fresh heartbeat and an available queue. Calibration should be **Pending** until physical inspection. Check that the Windows queue has no held or pending job.
4. Wait for separate approval before opening **Test / Review Calibration** and confirming **one TEST label**. Inspect the count, upright black text on white, complete frame, margins, clipping, and whether the stock stopped at the next gap.
5. Choose **All Passed** only after seeing one usable label. For uncertain, missing or incorrect output, inspect the printer, clear held Windows output, then choose **Inspected / Issue**. Keep the recovery evidence and obtain renewed approval before another label. For uncertain Job Order jobs, use **Confirm Printed** or **Report Issue** in FeedX Print History.

## Guided installer

1. In FeedX Staging, open **Factory Settings → Label Management → Printers → Set Up Printer**. Run the Windows installer on the printer computer. It installs per user and uses the Windows 10/11 inbox PowerShell 5.1 and .NET Framework runtime. The Windows Driver and RAW TSPL options require an installed queue. Use the D520 Bluetooth option for the paired Classic device.
2. Open **FeedX Print Bridge Staging** from Start. Choose **Connect / Configure**, then sign in with the authorized Staging operator, choose the paired D520 or installed queue, and set stock dimensions. Use portrait. Set stock and gap on the printer driver for Windows Driver printing. Choose RAW TSPL only for a verified compatible queue.
3. Use **Connection Check** to validate the selected transport, or **Reconnect** to restart the background task. With separate physical approval, select **Test / Review Calibration**, approve one TEST label and inspect the actual output. Review a pending test before attempting another. The printer appears in the Web wizard where heartbeat, printer status, calibration and unresolved jobs are shown separately.
4. The background task starts at Windows sign-in under the current user. Reopen the app and choose **Reconnect** to reuse the saved printer and calibration, or **Reauthorize** as the original operator. Returning configuration uses its recorded media and transport. Session-store and network errors back off while preserving the pending print journal. Installing a newer copy replaces program files and preserves the device configuration, DPAPI session, calibration, and journal under `%LOCALAPPDATA%\FeedXPrintBridge`.

The Staging executable is unsigned. Authenticode signing and enterprise policy validation are prerequisites for commercial distribution. The following legacy instructions apply to the old script archive.

## Legacy script setup

Windows 10/11, Windows PowerShell 5.1 and .NET Framework (included with Windows) are required. No Labelife or inbound network port is used. The current Windows user must remain signed in; a locked screen is fine. The per-user scheduled task starts at sign-in and runs without administrator privileges.

1. Pair the D520 in Windows Bluetooth settings and install its vendor Windows printer driver. Print the Windows test page. FeedX discovers installed Windows queues; it does not pair Bluetooth devices.
2. Extract this complete package to a local folder. Review the scripts and run `powershell.exe -NoProfile -File .\Install-Bridge.ps1`. If Windows marks the downloaded files as blocked, review them and use Properties → Unblock (or `Get-ChildItem . -Recurse | Unblock-File`). Follow your organization’s PowerShell signing policy; the package does not bypass it.
3. Select the exact Windows queue name. Enter the **Staging public publishable/anon key**, never a service key, and sign in with an active FeedX Staging employee account with `factory_production.complete`. The endpoint is fixed to `ujkzdaaadnvcfayuldmh.supabase.co`; Production endpoints are not configurable.
4. In FeedX **Factory Settings → Label Management → Product Labels**, open the existing Packaging SKU’s **Label Editor** (Finished Goods retains a shortcut to the same editor). Review all product, regulatory and static template content. Supply approved storage instructions, shelf life/rule, net weight and approval reason. Save a Draft, review the canonical preview, then Approve & Publish a new version with a reason. Publishing requires explicit content approval and `factory_finished_goods.edit`. Drafts do not affect printing. Shared layouts are managed separately in Templates; existing SKU assignments stay pinned until explicitly reassigned and approved.
5. Open completed Job Order → **Print Labels**, select its actual completed batch and registered bridge, inspect the preview, and confirm label quantity. Print one calibration label first. Each original label consumes the recorded packaged-unit allowance, even if its outcome later fails. Subsequent recovery is an audited reprint.
6. Configure the printer driver for the exact 80×90 mm media, 203 DPI, no scaling and appropriate gap sensing. Measure the paper output. FeedX refuses a driver printable area smaller than the label. Any vendor driver rounding, orientation, margins, gap and Bluetooth behavior require hardware calibration.

## Setup diagnostics

In **FeedX Print Bridge Staging**, choose **Export Diagnostics** and save the JSON report. It includes up to eight recent setup and manual connection-check failures, with the step, UTC timestamp and Windows or HTTP codes when available. Reports exclude credentials, tokens, user and device identifiers, Bluetooth addresses, and server response bodies. Export remains available with a broken saved configuration. Reports stay local until you share them with FeedX support.

After a setup error, follow the step shown in the dialog. Rerun **Connect / Configure** if printer settings were not saved. If setup saved the printer but Windows could not start the background task, choose **Reconnect**. Use **Connection Check** to verify availability without printing.

## Security and local operation

Only outbound HTTPS is used. The operator password is used once to sign in and is not saved. Session/refresh credentials and the interruption journal use Windows user-bound DPAPI with atomic writes under `%LOCALAPPDATA%\FeedXPrintBridge`; installer ACLs restrict the directory to the user and SYSTEM. No tokens or HTTP response bodies are logged. The non-secret public key and queue settings are in `config.json`. Use a dedicated least-privileged employee account where operationally appropriate; this is normal FeedX Auth, with permissions and active employment checked on every RPC. Disable the employee’s access through the existing identity workflow to revoke bridge authority.

If sign-in expires or changes, run the installer again with the same Windows user. It preserves device identity and the interruption journal. Do not copy session files between users/computers. Check Task Scheduler → **FeedX Print Bridge Staging**, Windows print queue, `%LOCALAPPDATA%\FeedXPrintBridge\status.txt`, and FeedX print history when troubleshooting. Stop the scheduled task before editing `config.json`.

## Delivery and recovery semantics

- **Queued**: saved in FeedX; offline printers do not claim new work.
- **Printing**: exclusively claimed by one bridge (10-minute lease); the local journal is flushed before any native printer call.
- **Sent**: the Windows spooler accepted the submission or the D520 returned a positive Bluetooth acknowledgment. Physical inspection is separate.
- **Confirmed**: a supervisor with `factory_production.verify` inspected the physical output and recorded a reason.
- **Failed**: no submission occurred, or an operator inspected/cancelled/discarded remaining output and recorded the outcome.
- **Unknown**: timeout, interruption, native transport error or expired claim. No automatic resend. An Unknown job blocks that bridge’s next claim until a supervisor records the outcome.

After a crash, an in-progress submission is reported Unknown; a saved result is retried only as a status report. Claim/result HTTP retries reuse stable claim IDs. The bridge never automatically submits a bitmap twice. A network partition can leave a pending report; restore connectivity and inspect history. On lease expiry, Printing becomes Unknown on the next online claim. A supervisor may also mark an expired Printing claim Unknown through Review Outcome.

Before reprinting Unknown/Sent work, check the printer for pending output, clear any held Windows spooler job if using a queue, and inspect or discard partial labels. FeedX cannot recall commands already accepted by a printer. Record a reason, then use **Reprint**; it copies the original immutable snapshot and pixels. A physically partial batch requires an explicit remaining quantity. Never delete `journal.xml` to force a retry.

## Replaceable transports

Default `spooler` uses .NET `PrintDocument` and the vendor Windows driver. `tspl` sends a bounded bitmap TSPL command through `WritePrinter` RAW to the same queue: install using `-Transport tspl` only after verifying the D520 firmware and driver accept uncompressed TSPL BITMAP. All Chinese, logos, QR and barcode content is rasterized by FeedX, avoiding printer font dependencies. `TsplInvert` defaults true (TSPL zero-bit = dark); `GapMm` defaults 2 and must match actual stock. Both are local calibration values. No untrusted cloud TSPL, shell commands or remote URLs are executed. Future transports belong in `Transport.cs` with the same exclusive claim/journal protocol.

**Pending physical D520 checks:** native RFCOMM service discovery and reconnect on Windows 10/11, target firmware response, label count, orientation, polarity, 80 × 90 mm output dimensions, margins, gap feed, paper-out recovery, and QR/barcode readability. RAW TSPL still requires a compatible installed queue and verified TSPL support.

## Remove

Run `powershell.exe -NoProfile -File .\Install-Bridge.ps1 -Uninstall`. It removes the scheduled task and stored sign-in. It preserves files and the interrupted-job journal for inspection. Resolve any in-flight jobs in FeedX before deleting the remaining folder.

## Layout format

A reusable template is `{ "elements": [...] }`. Each element has millimetre `x,y,w,h`; text additionally has `size`, optional `bold`, `align`, `prefix`, `suffix`, `date_format:"dd/MM/yyyy"` and either `field` or static `text`. Fields: `product_name`, `product_name_cn`, `product_name_bm`, `product_code`, `variant_name`, `net_weight`, `storage_instructions`, `ingredients`, `manufacturer_name`, `manufacturer_address`, `manufacturing_date`, `expiry_date`, `batch_no`, `packaged_units`. The last four are read-only Production fields; label content cannot override them. Supported types: `text`, `rect` (optional `radius,stroke`), `line`, `qr`, `barcode` (Code 39), `image` (embedded PNG `src`). QR uses M correction and quiet zones; QR/barcode require at least two dots per module. All text must fit; FeedX refuses overflow. Freeze approved logo pixels as embedded PNGs. The screenshot’s certification seal has deliberately not been copied as approved artwork.
