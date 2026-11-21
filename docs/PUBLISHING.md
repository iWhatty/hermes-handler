# Publishing

HermesHandler is published to npm as `hermes-handler`.

## Release Checklist

1. Confirm the approved version and set it in `package.json` and `CHANGELOG.md`
   before packaging.
2. Install the locked dependencies with `corepack pnpm install --frozen-lockfile`.
3. Run `corepack pnpm test`, `corepack pnpm run lint`, and `corepack pnpm run build`.
4. Inspect the package contents with `corepack pnpm pack --dry-run`, then create
   the release archive with `corepack pnpm pack --pack-destination "path/to/staging"`.
5. Verify the packed package and record its SHA-256 in the release handoff.
   Keep that archive for publishing and commit the release changes.
6. After explicit publish approval, upload the verified archive with
   `corepack pnpm publish "path/to/hermes-handler-<version>.tgz" --access public`.
7. Verify the published version, dist-tag, and tarball checksum in the registry.

The publish command accepts a prepared `.tgz` archive. [pnpm publish reference](https://pnpm.io/cli/publish)

## Versioning Notes

- Patch: bug fixes and documentation-only package polish.
- Minor: backward-compatible API additions such as new options.
- Major: changed defaults, changed response envelopes, or removed APIs.

The `dist/` directory is generated during build and included in the npm package, but it is not tracked in git.

