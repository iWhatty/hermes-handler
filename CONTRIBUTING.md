# Contributing to HermesHandler

Thanks for helping improve HermesHandler. The project is a small public npm package used by existing applications, so contributions should stay focused, compatible, and easy to verify.

## Start here

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the runtime map, invariants, and safe refactor seams.
- Read [docs/ROADMAP.md](docs/ROADMAP.md) for planned work and compatibility boundaries.
- Read [docs/CODEX_WINDOWS.md](docs/CODEX_WINDOWS.md) when developing on Windows.
- Read [docs/PUBLISHING.md](docs/PUBLISHING.md) only for release-related work.

## Development setup

HermesHandler requires Node.js 18 or newer and uses the pnpm version pinned in `package.json` through Corepack.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run lint
corepack pnpm run build
```

Before release-related changes, also inspect the package contents:

```sh
corepack pnpm pack --dry-run
```

`dist/` is generated output. Do not edit or commit it.

## Contribution expectations

- Keep the runtime dependency-free unless maintainers explicitly approve a dependency.
- Preserve the canonical `{ ok, result, error, info, requestId }` envelope.
- Preserve listener ownership and timeout defaults unless a major-version plan says otherwise.
- Keep direct `dispatch()` deterministic.
- Add focused behavioral tests for source changes.
- Add type tests for public generic or declaration changes.
- Add built-package checks for exports or package-layout changes.
- Prefer small named helpers over generalized frameworks.
- Update documentation when public behavior or contributor workflow changes.

## Compatibility and releases

Treat runtime behavior and TypeScript acceptance as public API:

- Patch changes may fix builds, packaging, transport failures, documented lifecycle behavior, and test gaps.
- Minor changes may add APIs, adapters, opt-in stricter types, or validation.
- Major changes are required for removed exports, changed envelopes/defaults, or stricter existing type contracts.

Do not bump the version, tag, publish, or change release status unless explicitly requested by a maintainer.

## Pull requests

Keep pull requests focused and explain:

1. the user or developer problem;
2. the compatibility impact;
3. the tests that prove the behavior; and
4. any follow-up deliberately left out of scope.

All CI jobs should pass on the supported Windows/Linux and Node.js matrix before merge.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.
