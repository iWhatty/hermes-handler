# hermes-handler

[![npm](https://img.shields.io/npm/v/hermes-handler)](https://www.npmjs.com/package/hermes-handler)
[![downloads](https://img.shields.io/npm/dm/hermes-handler)](https://www.npmjs.com/package/hermes-handler)
[![bundle size](https://img.shields.io/bundlephobia/minzip/hermes-handler)](https://bundlephobia.com/package/hermes-handler)
[![license](https://img.shields.io/npm/l/hermes-handler)](https://github.com/iWhatty/HermesHandler-JS/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/iWhatty/HermesHandler-JS?style=social)](https://github.com/iWhatty/HermesHandler-JS)

Lightweight, framework-agnostic message router for browser extensions and event-driven systems. Strict response envelope, built-in timeouts, cooperative cancellation, and a tiny client subpath for size-sensitive bundles.

## Features

- Deterministic message routing via `type`
- Strict response envelope: `{ ok:true, result?, info? } | { ok:false, error, info? }`
- Built-in timeout handling
- Cooperative cancellation via `AbortSignal`
- Immutable (shallow-frozen) responses
- LLM-friendly deterministic contract
- Framework-agnostic (no runtime dependencies)
- Type-safe via generated `.d.ts`
- Tiny client-side helper via `hermes-handler/client` subpath (≈ 1 KB minified). Speaks the same wire envelope without bringing the router class into size-sensitive bundles.

---

## Install

```sh
pnpm add hermes-handler
```

---

## Quick start

```js
import { HermesHandler } from "hermes-handler";

const handlers = {
  ping: () => ({ ok: true, result: "pong" }),

  greet: (msg) => {
    return { ok: true, result: `Hello ${msg.payload.name}` };
  }
};

const hermes = new HermesHandler(handlers);

const res = await hermes.dispatch({ type: "ping" });

if (res.ok) {
  console.log(res.result); // "pong"
}
```

---

## API

### `new HermesHandler(initialHandlers?, options?)`

**initialHandlers**
`Record<string, HermesHandlerFn>`

**options**

- `timeoutMs?: number`
- `onUnknown?: (msg, ctx) => HermesResponse`
- `onError?: (err, msg, ctx) => HermesResponse`
- `ignoreUnknown?: boolean`
- `shouldHandle?: (msg, sender) => boolean`
- `logger?: HermesLogger | null`

### `.register(type, fn)`

Register or overwrite a handler.

### `.registerMany(map)`

Register multiple handlers at once.

### `.unregister(type)`

Remove a handler.

### `.has(type)`

Check if a handler exists.

### `.getListener()`

Returns a runtime-compatible message listener.

### `.dispatch(msg, sender?)`

Dispatch a message manually (useful for testing or non-extension environments).

### `.types()`

List registered message types (registration order).

### Response envelope

All responses follow a strict envelope. Hermes never mutates `result`; any unexpected or conflicting fields are preserved under `info`. If a handler returns inconsistent envelopes (e.g. `{ ok:false, error, result }`), Hermes warns and preserves extras under `info`. If a handler returns an envelope that already includes `info`, Hermes preserves it under `info.handlerInfo` when additional fields must also be recorded.

**Success**

```js
{ ok: true, result: any, info?: any }
```

**Error**

```js
{ ok: false, error: string, info?: any }
```

Primitive return values are automatically normalized. `return "hello"` becomes `{ ok: true, result: "hello" }`. Malformed envelopes are coerced into valid error responses.

---

## Notes

### Browser extension usage

Attach hermes-handler to a runtime listener:

```js
browser.runtime.onMessage.addListener(
  hermes.getListener()
);
```

Both styles are supported:

- Promise-returning listeners (MV3 / Firefox / polyfill)
- Callback-style `sendResponse + return true`

#### Ignoring messages owned by other listeners

Browser extensions can have multiple `runtime.onMessage` listeners alive at the same time. By default, hermes-handler preserves its original behavior and responds to unknown message types with an error envelope.

If a listener should only claim messages it knows how to handle, enable `ignoreUnknown`:

```js
const hermes = new HermesHandler(handlers, {
  ignoreUnknown: true
});
```

When `ignoreUnknown` is enabled, `getListener()` returns `false` for runtime messages whose `type` is missing or not registered. That lets another listener handle the message instead of racing it with an unknown-message response.

For scoped extension pages or richer ownership rules, provide `shouldHandle`:

```js
const hermes = new HermesHandler(handlers, {
  shouldHandle: (msg) => msg?.scope === "popup" || hermes.has(msg?.type)
});
```

When `shouldHandle` is provided, it is the runtime listener ownership predicate. If it returns `true`, hermes-handler uses normal dispatch behavior. If it returns `false`, the listener returns `false` without sending a response.

### Half-and-half: server router + tiny client

hermes-handler has two natural sides:

- **Server side.** Runs the handlers. You want the full `HermesHandler` class here (routing, normalization, per-handler timeout, AbortSignal plumbing).
- **Client side.** Sends a request and parses the envelope. You don't need the router; you need ~1 KB of wire-correlation glue.

For size-sensitive contexts (page-world bundles, popups, child processes), import the client subpath instead of the class:

```js
// page-world / popup / inline-injected bundle
import { createHermesClient } from "hermes-handler/client";

const dispatch = createHermesClient({
  send:      (msg) => window.parent.postMessage(msg, "*"),
  subscribe: (handler) => {
    const listener = (e) => handler(e.data);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  },
  defaultTimeoutMs: 8000,
});

const res = await dispatch({ type: "code-source.fetch", payload: { url } });
if (res.ok) console.log(res.result);
else        console.warn(res.error, res.info);
```

`createHermesClient` handles `requestId` correlation, per-call timeout, `AbortSignal`, and envelope normalization. The wire shape is the contract; the client is one implementation of it. Half-and-half is fine and often correct.

### Timeouts

Handlers can be time-limited:

```js
const hermes = new HermesHandler(handlers, {
  timeoutMs: 7000
});
```

If exceeded, hermes-handler returns:

```js
{ ok: false, error: "Handler <type> timed out (7000 ms)" }
```

Pick a timeout longer than the longest legitimate handler. If any handler awaits a `fetch()` or other network call, match or exceed that call's own timeout. Use `timeoutMs: 0` to opt out entirely when the caller doesn't care about the reply.

### Cooperative cancellation

Each handler receives an `AbortSignal`:

```js
async function longTask(msg, ctx) {
  if (ctx.signal?.aborted) {
    return { ok: false, error: "Cancelled" };
  }

  ctx.signal?.addEventListener("abort", () => {
    console.log("Cancelled externally");
  });
}
```

hermes-handler aborts the signal once a request lifecycle completes.

### Logging

hermes-handler emits warnings and errors through a configurable logger. By default, it uses the global `console`. You can disable logging entirely or provide a custom logger implementation.

**Disable logging**

```js
const hermes = new HermesHandler(handlers, {
  logger: null
});
```

**Custom logger**

```js
const hermes = new HermesHandler(handlers, {
  logger: {
    warn: (...args) => myLogger.warn(...args),
    error: (...args) => myLogger.error(...args)
  }
});
```

**HermesLogger shape**

```ts
interface HermesLogger {
  debug?(message?: any, ...optionalParams: any[]): void;
  info?(message?: any, ...optionalParams: any[]): void;
  warn?(message?: any, ...optionalParams: any[]): void;
  error?(message?: any, ...optionalParams: any[]): void;
}
```

If `logger` is `null`, hermes-handler will not emit any console output.

### Design goals

hermes-handler enforces a predictable and deterministic runtime contract. By standardizing request/response handling and isolating message dispatch logic, it simplifies reasoning about complex systems, particularly those involving automation, background scripts, or LLM-driven tool execution. The core remains intentionally minimal, dependency-free, and portable.

### Project docs

- [Publishing checklist](docs/PUBLISHING.md)
- [Roadmap and API direction](docs/ROADMAP.md)

---

## License

Licensed under AGPL-3.0 with WATT3D Additional Terms. See [LICENSE](./LICENSE) and [ADDITIONAL_TERMS.md](./ADDITIONAL_TERMS.md). Commercial AI/model-training use requires compliance with those terms or a separate WATT3D license. © WATT3D.
