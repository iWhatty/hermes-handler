# Architecture

HermesHandler is a dependency-free message routing and RPC package for browser extensions, workers, threads, and other JavaScript runtimes. It provides one deterministic request/response envelope, routing, timeouts, cooperative cancellation, middleware, correlation, and transport adapters so applications do not have to rebuild those primitives.

This document describes the current architecture and the boundaries contributors should preserve.

## Design principles

- Keep the runtime dependency-free, small, and transport-agnostic.
- Resolve every handled request to a canonical Hermes envelope.
- Keep direct `dispatch()` deterministic, including invalid and unknown messages.
- Let runtime listeners explicitly decline messages they do not own.
- Preserve wire compatibility and published defaults for existing npm consumers.
- Prefer additive APIs and focused helpers over framework abstractions.
- Treat source readability, type accuracy, tests, and package exports as one public contract.

## Public package surface

| Entry point | Purpose |
| --- | --- |
| `hermes-handler` | `HermesHandler`, `createHermesClient`, and transfer-list helpers |
| `hermes-handler/client` | Size-sensitive client without the router runtime |
| `hermes-handler/guard` | Route declarations, sender classification, and guard middleware |
| `hermes-handler/transports/postmessage` | Window, Worker, and MessagePort client/server glue |
| `hermes-handler/transports/chrome-runtime` | Chrome extension runtime and tab messaging |
| `hermes-handler/transports/broadcast-channel` | BroadcastChannel transport |

All public entry points must agree across `package.json#exports`, runtime modules, generated declarations, documentation, and package-consumer tests.

## Router core

`src/HermesHandler.js` owns handler registration and request dispatch. Internal modules own wire-envelope normalization, timeouts, error conversion, and response transfer metadata.

```text
runtime listener
  -> listener ownership gate
  -> dispatch message validation
  -> request context and AbortController
  -> middleware chain
  -> handler lookup and timeout
  -> response normalization and freezing
  -> transfer-list association
  -> canonical Hermes envelope
```

`getListener()` applies listener ownership rules before dispatch. Direct `dispatch()` deliberately bypasses that gate so tests, adapters, and non-extension callers always receive a deterministic Hermes response.

Middleware is composed in registration order, with the first middleware acting as the outermost wrapper. The terminal handler result is normalized before returning through the middleware chain. A final normalization pass is intentional and idempotent.

### Router invariants

- Handler selection is a string-to-handler map keyed by `msg.type`.
- The first `ctx.send()` call settles the response; later calls are ignored.
- Every returned value is normalized to `{ ok: true, result?, info? }` or `{ ok: false, error, info? }`.
- Request IDs are echoed unless a response explicitly provides one.
- Responses are shallow-frozen at the router boundary.
- Timeouts stop waiting but do not forcibly terminate handler work; handlers receive an `AbortSignal` for cooperative cancellation.
- Transfer lists remain outside the serialized envelope and are associated by envelope identity.

## Client lifecycle

`src/client.js` creates one callable client with `dispatch`, `on`, `off`, and `close` methods. It depends only on a `{ send, subscribe }` transport contract.

```text
dispatch request
  -> validate client state and message type
  -> generate unique requestId
  -> register pending settlement
  -> attach timeout and abort cleanup
  -> transport.send
  -> subscription receives correlated response
  -> parse canonical wire response
  -> clear pending resources and resolve once
```

Messages with a `requestId` are treated as responses. Messages without one are treated as broadcasts and routed by `type` to `.on()` subscribers.

### Client invariants

- Active-request response, timeout, abort, send-failure, and close paths converge on one settlement mechanism; duplicate IDs fail before send.
- A request settles at most once and always clears timers and abort listeners.
- `close()` is terminal and idempotent: it unsubscribes once, settles pending calls, and prevents future sends.
- Post-close dispatch returns an error envelope rather than throwing.
- Post-close `.on()` is a compatibility-friendly no-op.
- Local abort stops the client waiting; it does not remotely cancel server work.

## Transport boundary

`src/transports/_base.js` defines the minimal client transport shape. Adapters should contain transport-specific behavior without changing the Hermes envelope.

- `postMessageTransport` supports Window, Worker, and MessagePort-shaped endpoints, discriminators, filters, origins, and request transfer lists.
- `servePostMessage` is the router-side request/reply bridge and forwards response transfer lists.
- `chromeRuntimeTransport` correlates Promise-based runtime/tab responses and observable send failures, and shares one native listener across local subscribers.
- `broadcastChannelTransport` relays peer messages across same-origin contexts.

Transport adapters must clean up subscriptions, preserve request correlation, and convert observable failures into Hermes error envelopes instead of allowing silent hangs or unhandled rejections.

## Type architecture

`src/types.d.ts` is the authored generic model for typed handler maps, route extraction, router dispatch, and clients. Runtime JSDoc declarations remain useful internally, but the published entry declarations define the consumer experience.

Type changes require the same compatibility care as runtime changes. Making an optional field required can break existing TypeScript applications even when runtime behavior is unchanged. Stricter payload typing should therefore remain opt-in until a major-version migration explicitly changes the default.

## Source and test map

| Area | Source | Primary tests |
| --- | --- | --- |
| Router and middleware | `src/HermesHandler.js` | `test/HermesHandler.test.js` |
| Envelope normalization | `src/internal/envelope.js` | router/client tests |
| Client lifecycle | `src/client.js` | `test/client.test.js` |
| Transfer metadata | `src/internal/transfer.js` | `test/transfer.test.js` |
| PostMessage serving | `src/transports/postmessage.js` | `test/transports/postmessage.test.js`, `test/transfer.test.js` |
| Chrome extensions | `src/transports/chrome-runtime.js` | `test/transports/chrome-runtime.test.js` |
| BroadcastChannel | `src/transports/broadcast-channel.js` | `test/transports/broadcast-channel.test.js` |
| Public generics | `src/types.d.ts` | `test/types.test-d.ts` and package-consumer type tests |
| Package contract | `package.json`, `scripts/` | built-package export checks |

## Contributor workflow

Use Corepack with the pinned pnpm version:

```sh
corepack pnpm test
corepack pnpm run lint
corepack pnpm run build
corepack pnpm pack --dry-run
```

Behavior changes need focused tests and the full suite. Public export or type changes also need built-package consumer coverage. Treat `dist/` as generated output and never publish or bump the npm version unless explicitly requested.

## Compatibility boundaries

- Patch releases may fix builds, package parity, transport failures, documented lifecycle behavior, and test gaps.
- Minor releases may add adapters, helpers, opt-in stricter types, or validation that could expose invalid usage.
- Major releases are required for envelope changes, removed exports, changed ownership or timeout defaults, and stricter existing type contracts.

## Refactor seams

The architecture does not currently need a generalized state machine. The client lifecycle is a small `open`/`closed` transition, while handler routing is already a string-to-function map.

The largest readability opportunity is the router dispatch implementation. Refactor it only after characterization tests cover its boundary behavior, using small named helpers for:

- dispatch state and context creation;
- terminal handler invocation;
- middleware composition; and
- response and transfer finalization.

Preserve normalization order, first-send-wins behavior, correlation, abort timing, and transfer identity throughout any extraction.

## Maintenance priorities

1. Keep built-package consumer fixtures covering every public entry point.
2. Keep root and client-subpath generic typings consistent.
3. Keep `servePostMessage` failures correlated and consume fire-and-forget rejections.
4. Preserve characterization coverage for user hooks, frozen envelope reuse, malformed wire responses, and timeout/transfer races.
5. Keep middleware, transport, TypeScript, ESM, and runtime-baseline guidance current.
6. Keep local verification portable across supported Windows and Linux Node versions.

See [ROADMAP.md](./ROADMAP.md) for release sequencing and deferred API ideas.
