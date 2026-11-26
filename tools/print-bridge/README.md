# FeedX Print Bridge 1.3.0 Production setup and release

When Production Label Printing is enabled, open **Factory Settings → Label Management → Printers → Set Up Printer** on the printer workstation. The setup steps are Install, Authorize, Connect Printer, Test Print, and Ready. Select an existing workstation to resume. **Troubleshooting** provides a status refresh and manual launch instructions for Applications on macOS or the Start menu on Windows.

The Bridge retrieves the public client configuration from `os.feedx.my`. First-time setup and reauthorization open a dedicated browser sign-in for the Production Auth project, using a one-use, nonce-bound callback on a random loopback port. The Bridge keeps its own session in macOS Keychain or Windows DPAPI. Returning devices retain their operator, identity, stock, calibration, and recovery evidence across upgrades.

The background worker reports heartbeat and printer observations separately. A connection check expires even if the Bridge remains online. Only inspect and confirm a test after it has been explicitly authorized. A Bluetooth write can complete without a positive acknowledgment. Review a held job in Job Order Print History and confirm the actual usable count before submitting further output.

### Shared D520 workstations

The native Bridges coordinate D520 access in the same FeedX environment using a renewable 120-second reservation. Use the guided v1.3.0 setup on each workstation using the printer. Reservations are scoped to one Supabase project. Stop the Staging Bridge before connecting the same D520 to Production. If a previous Production-bound private build was installed, open setup and connect or reconnect before relying on reservation support.

### Commercial distribution and activation

Build the unsigned Windows EXE with NSIS from `tools/windows-print-bridge/Setup.nsi`. Build the ad-hoc review PKG with `tools/macos-print-bridge/package.sh` and the pinned Python requirements. Write both outputs to a private location outside source and hosted downloads.

- **Windows.** Sign with an organization-approved, publicly trusted Authenticode identity backed by an approved signing service or hardware-protected key. Use SHA-256 and an RFC 3161 timestamp. Verify with SignTool and test the installed scripts under the managed workstation's PowerShell and application-control policy. Include the uninstaller and script signatures where the policy requires them.
- **macOS.** Sign nested libraries, executables, helpers, and the app with Developer ID Application, hardened runtime, and a secure timestamp. Sign the PKG with Developer ID Installer. Submit with `notarytool` using the owner's authorized signing environment, staple the accepted ticket, and verify the final package with Gatekeeper.
- **Activation.** Apply the setup migration through the reviewed Production migration procedure before exposing setup. Verify the signed installers and hashes on approved distribution, including a clean install, upgrade, browser sign-in, and reconnect on the final signed payloads. Then authorize Production rollout and enable both `VITE_FACTORY_LABEL_PRINTING_ENABLED` and `FACTORY_LABEL_PRINTING_ENABLED` against the canonical Production host and project. Keep the private unsigned review builds out of hosted downloads.

The two Vercel flags control the visible web workflow and bootstrap endpoint. The existing Production RPCs use their own authenticated Factory permissions. The flags do not revoke those database permissions.

- [Microsoft Windows code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [Apple Developer ID](https://developer.apple.com/developer-id/)
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
