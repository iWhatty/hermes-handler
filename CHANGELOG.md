# CHANGELOG — `hermes-handler`

What changed for people using the package, per release. Entries before 1.1.0 were reconstructed from git history.

## Unreleased

- `client.close()` ignores replies and broadcasts emitted during transport teardown.

## 1.1.1 — 2026-11-02

- `createHermesClient` is exported from the package root, matching the type declarations.
- `client.close()` is final: pending dispatches resolve right away with a closed-client error instead of waiting for their timeout, and later dispatches return that error without touching the transport.
- A failing `idGen`, an empty id or a duplicate `requestId` resolves the dispatch with an error instead of throwing or mixing up replies.
- The Chrome runtime transport reports send failures as error responses instead of leaving the client to time out, and detaches its listener when the last subscriber leaves.
- The postMessage transport and `servePostMessage` call `start()` on a MessagePort, so replies arrive on real ports.

Behavior change: dispatches pending at `close()` used to resolve with their timeout error, or never when the timeout was disabled.

## 1.1.0 — 2026-06-12

- Transferables in both directions: `dispatch({ transfer })` passes a transfer list to the transport, and handlers return their own with `ctx.transfer(...)`. `getTransferList` and `setTransferList` are exported.
- `servePostMessage(hermes, endpoint, opts?)` serves a HermesHandler from a Web Worker, MessagePort or Window.
- Fix: replies from real Workers, whose `event.source` is `null`, are accepted.

## 1.0.3 — 2026-05-21

- Envelope `info` and success shorthand are normalized more consistently.

## 1.0.2 — 2026-05-20

- Fix: importing the client no longer bundles the whole envelope module.

## 1.0.1 — 2026-05-20

- Documented the handler return contract.

## 1.0.0 — 2026-05-20

- End-to-end TypeScript inference from the handler map to the client.

## 0.2.0 — 2026-05-20

- Middleware: `.use(fn)`.

## 0.1.0 — 2026-05-20

- `.on()` for broadcasts the server starts.

## 0.0.8 — 2026-05-20

- Transport adapters for postMessage, Chrome runtime and BroadcastChannel.

## 0.0.7 — 2026-05-20

- Per-handler config blocks, such as a per-handler `timeoutMs`.

## 0.0.6 — 2026-05-20

- Responses echo the request's `requestId`.

## 0.0.5 — 2026-05-20

- `hermes-handler/client` subpath.
- Relicensed to AGPL-3.0 with WATT3D Additional Terms.

## 0.0.4 — 2026-05-12

- Listener ownership controls.

## 0.0.3 — 2026-02-17

- Clearer response envelope types and normalization.

## 0.0.2 — 2026-02-13

- More exported types.

## 0.0.1 — 2026-02-13

- First release: `HermesHandler`.
