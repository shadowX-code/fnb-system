# Repository Guidelines

## FeedX Guest AI Development Context

Before any task, read and follow `FEEDX_CODEX_CONTEXT.md`; it is the detailed canonical rule source. Guest AI is a self-contained bounded module in the FeedX repository during prototype and validation. Keep coupling to Crew, Factory, and other features minimal: use shared components, service/API boundaries, and public contracts rather than private business logic. Preserve this boundary for future extraction into an independent repository or service.

## Git & Worktree Safety

The normal Guest AI worktree is `/Users/deron/Dev/feedx-guest-ai` on `guest-ai/dev`. Before every write, commit, or push, confirm the worktree, branch, and target. Normal Guest AI work goes only to `origin/guest-ai/dev`; never overwrite, reset, or force-push canonical `dev`.

For a Guest AI Staging milestone: inspect current `origin/dev`; integrate only intended Guest AI changes while preserving newer FeedX work; run relevant regression tests, `npm run build`, and `git diff --check`; then push canonical `dev`, verify `fnb-system-staging`, and complete authenticated QA. Fix, redeploy, and retest any defect. Never deploy Production, merge `main`, or reset, clean, stash, or discard Guest AI dirty/untracked work without explicit approval.

## Project Structure

Guest AI ownership is rooted at `src/features/guest-ai/`. Keep device, protocol, runtime, firmware, tests, tools, and technical documentation in Guest AI-owned paths where practical. Reuse existing Supabase service, RPC, RLS, audit, and versioning boundaries; clients submit intent rather than becoming protected-state authorities.

## Build & Test

Use `npm ci` for a clean dependency install; do not install or upgrade dependencies unless needed. Start with focused Guest AI tests, widening to shared regression only when a shared contract is affected. Run `npm run build` for integration risk and `git diff --check` before handoff.

Frontend tests use Vitest and React Testing Library. Use the existing Guest AI native/firmware test approach for firmware. Cover protocol, reconnect/session lifecycle, failure paths, permissions, and hardware boundaries. Do not claim device, firmware, or Staging QA passed unless it actually ran.

## Firmware & Device Safety

Do not automatically flash firmware, erase flash/NVS, overwrite OTA or recovery partitions, change partition layouts, alter secure boot or flash encryption, modify `.device-backups`, or run destructive serial/device commands. First review the existing firmware and recovery documentation; default to build, test, and dry-run before any physical write. Keep `.device-backups` local and uncommitted. Generated firmware, build/cache output, binaries, managed dependencies, and secrets remain excluded by `.gitignore`.

## Security & Configuration

Never commit credentials, tokens, passcodes, `.env` files, or device recovery dumps. Use minimal forward-only migrations for shared-environment database changes. Security-sensitive RPC, RLS, authentication, session, or device-identity changes require authorization and auditability verification.
