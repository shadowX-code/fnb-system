# FeedX AutoCount Connector for Windows

Download the Staging installer from **Finance → Data Sources → Connect provider → AutoCount Desktop**. Install it under the Windows account that will run sync. Generate a pairing code in Finance and enter it in the Connector. Choose a local SQL instance, find database candidates, and select AED_TEST for the initial acceptance run. A local SQL administrator must approve the individual Account Book before the connector reports its company and readiness.

In FeedX, select the active Legal Entity for the authorized book and click **Connect book**. The Connector picks up new bindings and retry requests in its five-minute check. It runs a daily sync while the installing Windows user is signed in. The date selected on Windows determines the first posting date to sync. The app can also start a manual sync for approved, bound books.

Use **Replace computer** in Finance to pair another PC to the same device record. Re-authorize the same books on that computer. The connection and accepted history stay on the original Legal Entity. The replacement computer starts a fresh local checkpoint from its chosen posting date. The server recognizes repeated batches and keeps changes as new snapshots. If the original SQL database identity changed, review the historical binding before creating a new one.

The installer is per user. It launches Windows PowerShell 5.1 and WinForms internally. It requires 64-bit Windows, a local SQL Server instance, and SQL authentication enabled for the dedicated read-only user. Discovery does not open other databases. The SQL adapter does not require the AutoCount SDK. Keep native reporting status separate from SQL verification.

To rebuild, run `python3 installer/build.py <output.exe> <staging-publishable-key-file>` from the connector directory with NSIS installed. The file must contain only the Staging publishable API key. The binary is a Staging test build and is unsigned.
