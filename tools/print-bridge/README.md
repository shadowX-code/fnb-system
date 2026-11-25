# FeedX Print Bridge release and setup

Open **Factory Settings → Label Management → Printers → Set Up Printer** on the computer connected to the printer. Download the shown installer and open the Bridge. If browser launch is unavailable, use **Applications** on macOS or the **Start menu** on Windows.

- Authorize in the browser on that computer. Sign in to the FeedX environment shown or use an email code when available. The Bridge stores its own session in the macOS Keychain or Windows DPAPI and reuses it. The temporary browser window talks directly to FeedX Auth over HTTPS. Its one-use, expiring callback is bound to a random loopback port and accepts only a same-origin, nonce-bound response. The local listener closes after authorization.
- Select the discovered printer and enter stock width, length and gap. Connection Check runs after saving and the worker reports its observation to FeedX. Returning configured devices check the connection and retain their calibration.
- Send a test only after confirming the printer is ready. Inspect and record the physical output. Existing pending tests are reviewed before any new test is offered.
- If the printer is missing, pair the D520 or install the OS queue and use **Rescan printers**. If another FeedX Bridge is using the same D520, stop the other Bridge on its own computer and allow its reservation to expire. Upgrade both computers to v1.3.0 or later before sharing a D520. Older packages cannot participate in the reservation. Device names, pending recoveries, and calibration remain with each registration.
- **Troubleshooting** exports sanitized diagnostics. **Manage** in FeedX shows the reported version, updates where the platform is known, and the last connection report.

## Production-bound packages

On an Apple silicon build host with NSIS, Python 3.13 with Tk, and the pinned macOS build requirements, run:

```sh
FEEDX_BRIDGE_BUILD_PYTHON=/path/to/python3.13 node tools/print-bridge/build-production.mjs /private/path/feedx-bridge-release
```

The build emits separate unsigned Windows and ad-hoc macOS candidates. Their local state, launch identifiers and endpoints are isolated from Staging. Candidates contain no bundled authentication keys. Keep them outside hosted downloads. Activation requires a separately authorized Factory release, the Production schema and setup-config endpoint, and an approved distribution channel.

For Windows, apply timestamped SHA-256 Authenticode signatures and test installation and PowerShell policy on a clean managed Windows profile. For macOS, sign the application and nested executables with Developer ID Application and hardened runtime, sign the package with Developer ID Installer, then notarize and staple it. Verify both final signed artifacts, published digests, clean install, upgrade and recovery before distribution.

- [Microsoft Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
- [Apple Developer ID notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
