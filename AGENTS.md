# Agent Guide

HermesHandler is a small public npm package, so changes should stay focused, well tested, and easy to review.

## Tooling

- Prefer `pnpm` via Corepack: `corepack pnpm <command>`.
- Run `corepack pnpm test` for behavior changes.
- Run `corepack pnpm run build` before publish-related changes.
- Run `corepack pnpm run lint` when touching source or tests.
- On Windows/Codex, read [docs/CODEX_WINDOWS.md](docs/CODEX_WINDOWS.md) before changing tooling or running publish/release commands.

## Code Style

- Keep the library dependency-free at runtime.
- Preserve backward-compatible defaults unless a version bump plan says otherwise.
- Prefer small options with clear browser-extension and general JavaScript semantics.
- Keep `dispatch()` deterministic: direct callers should receive Hermes envelopes.
- Keep runtime listener behavior explicit: listener ownership gates may return `false` so other listeners can handle a message.

## Publishing

- Do not bump the npm version or publish unless explicitly requested.
- Keep npm package contents aligned with `package.json#files`.
- Treat `dist/` as generated output.
