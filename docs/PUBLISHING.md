# Publishing

HermesHandler is published to npm as `hermes-handler`.

## Release Checklist

1. Confirm the intended version bump: patch, minor, or major.
2. Install with pnpm: `corepack pnpm install`.
3. Run tests: `corepack pnpm test`.
4. Run lint: `corepack pnpm run lint`.
5. Build package output: `corepack pnpm run build`.
6. Inspect the package contents: `corepack pnpm pack --dry-run`.
7. Update `package.json` version.
8. Commit the release changes.
9. Publish when ready: `corepack pnpm publish --access public`.

## Versioning Notes

- Patch: bug fixes and documentation-only package polish.
- Minor: backward-compatible API additions such as new options.
- Major: changed defaults, changed response envelopes, or removed APIs.

The `dist/` directory is generated during build and included in the npm package, but it is not tracked in git.

