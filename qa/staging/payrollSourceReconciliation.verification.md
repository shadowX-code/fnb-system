# Payable Time source reconciliation

QA level: L3 Canonical. Scope: explicit reconciliation of changed source evidence.

Production forensic: Austin Hew Kin Yet, Hing Wei Guang and Low Tze Shin retained
16 Sep pre-publication snapshots. Holiday None → Hari Malaysia; Regular → Public
Holiday; Missing Punch → Public Holiday Review + Missing Punch. Published holiday
evidence was added 4 Oct 01:09 MYT. All other source fields remained identical.
No Production decision was mutated during investigation or QA.

Focused verification:
- Rollback Staging contract simulates the exact prior historical snapshot against
  actual published Hari Malaysia fixture evidence. Stale save rejects; explicit
  reconciliation creates an unresolved revision with no approved minutes.
- Lost-response retry returns the same revision and exactly one audit.
- Explicit subsequent decision uses the existing save authority.
- Genuine replacement Roster publication changes start/end and remains protected;
  a second explicit reconciliation preserves the original historical snapshot.
- Existing finalization blockers remain enforced; private helper grants denied.
- React contract verifies source details, explicit reconciliation, no automatic
  approval and Save & Next retained queue.
- Existing review/decision recovery regressions: 22 passed; new contracts: 2 passed.
- Production build passed. Runtime/release results recorded after delivery.
