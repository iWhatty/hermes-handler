# TypeScript example

This compile-only example uses the package's current public root declarations to infer a typed client from a handler map.

Build the package first so package self-references resolve to `dist`, then type-check the example:

```sh
corepack pnpm run build
corepack pnpm exec tsc -p examples/typescript/tsconfig.json
```

The example is not executed; its transport is only a declaration-compatible stub.
