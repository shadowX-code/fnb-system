# Repository Guidelines

## FeedX Guest AI Development Context

Before development, read and follow `FEEDX_CODEX_CONTEXT.md`. It is canonical for Git/worktree workflow, `dev` integration, environment boundaries, and Guest AI integration.

Keep Guest AI development isolated in this worktree. Do not overwrite, reset, or force-push `dev`. For Staging, integrate only intended Guest AI changes into latest `origin/dev`, preserving newer FeedX work. Never reset, clean, stash, or discard Guest AI dirty/untracked work without explicit approval. Never deploy Production or merge `main` without approval.

## Project Structure & Module Organization

FeedX is a Vite/React operations platform. Entry and styling are in `src/main.jsx` and `src/styles/`; reusable UI is in `src/components/`, layouts in `src/layouts/`, and domain logic in `src/services/`. Features are grouped under `src/features/` (for example, `factory/`, `crew/`, and `guest-ai/`). Supabase access is centralized in `src/lib/supabase.ts` and established services.

## Build, Test, and Development Commands

- `npm install` installs dependencies.
- `npm run dev` starts the local Vite development server.
- `npm test` runs the complete Vitest suite with local placeholder Supabase variables.
- `npm run test:factory` runs only Factory feature tests.
- `npm run build` creates a production build.
- `git diff --check` catches whitespace errors before handoff.

## Coding Style & Naming Conventions

Use ES modules, function components, two-space indentation, and double quotes. Use PascalCase for pages/components (for example, `GuestAiDeviceConsolePage.jsx`) and camelCase for services/utilities (for example, `deviceProtocol.js`). Reuse shared components and service boundaries. No lint or formatter command is configured; match nearby code.

## Testing Guidelines

Vitest runs in `jsdom` with React Testing Library. Place tests in `__tests__/` or feature test folders; use `*.test.js`, `*.test.jsx`, or `*.contract.test.js`. Test changed behavior, contracts, permissions, and lifecycles. No coverage threshold is stated.

## Commit & Pull Request Guidelines

Recent history uses concise imperative subjects, often scoped Conventional Commit style such as `feat(guest-ai): restore independent workspace`; UI work may use `Refine Crew ...` or `Fix ...`. Keep commits narrow. PRs should state scope and verification, link issues, include UI screenshots, and call out migrations, RPC/RLS changes, or environment assumptions.

## Security & Configuration

Do not commit secrets or log credentials, tokens, passcodes, or provider material. Supabase remains the authority for protected business state: honor RLS and existing RPC/service boundaries, and use forward-only migrations for shared environments.
