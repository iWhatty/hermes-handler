# Transport Guide

HermesHandler keeps routing separate from delivery. `createHermesClient()` only needs a transport with `send(message, transfer?)` and `subscribe(handler)`, while the router owns request handling on the other side.

## Choose an adapter

| Adapter | Use it for | Router side |
| --- | --- | --- |
| `postMessageTransport` | Workers and `MessagePort` endpoints where one object sends and receives | `servePostMessage` |
| `chromeRuntimeTransport` | Extension pages, content scripts, tabs, background workers | Register `hermes.getListener()` with `runtime.onMessage` |
| `broadcastChannelTransport` | Same-origin pages/workers with peer coordination | Elect one peer to dispatch and reply |

All adapters use the same request and response correlation contract. A request/reply message has a `requestId`; a message without one is fire-and-forget. Server broadcasts also omit `requestId` and are delivered through `dispatch.on(type, handler)`.

## postMessage: Worker and MessagePort

Use `postMessageTransport(endpoint)` on the client and `servePostMessage(hermes, endpoint)` beside the router. The endpoint must be the object used for both `postMessage()` and message subscription, such as a Worker or MessagePort. Real MessagePort endpoints are started automatically.

Transfer lists move supported objects instead of cloning them:

```js
const response = await dispatch({
  type: "image.resize",
  payload: { bytes },
  transfer: [bytes],
  timeoutMs: 10_000,
});
```

After a successful transferring send, the sender must treat transferred buffers as detached. Router handlers can call `ctx.transfer(value)` to transfer response objects back.

`AbortSignal` and client timeout stop the local caller from waiting. They do not cancel remote work. A remote cancellation protocol must be modeled as its own message if the operation needs cooperative cancellation.

For fire-and-forget delivery, call the transport directly without a `requestId`:

```js
transport.send({ type: "telemetry.record", payload: event });
```

The receiving handler must still return a value or call `ctx.send()` so its own lifecycle settles cleanly. The serving adapter suppresses the reply when the inbound message has no request ID.

### Window and iframe boundary

The current `postMessageTransport` accepts one object for both sending and listening. Browser parent/child messaging uses different objects: messages are sent to the remote window but received on the local window. Do not pass `parent`, `top`, or an iframe's `contentWindow` directly to this adapter.

For cross-window RPC, provide a small custom `{ send, subscribe }` transport that sends to the remote window and subscribes on the local window. Apply an exact `targetOrigin`, and validate both `event.origin` and `event.source` before forwarding an inbound message to Hermes. The router side needs the corresponding local-listener/remote-reply bridge.

Discriminator fields can help route application messages but are not authentication. Do not accept privileged commands solely because a caller supplied an expected string field.

## Chrome runtime ownership

The client uses `chromeRuntimeTransport()`. The background/content side should register the router listener directly so Chrome owns its asynchronous `sendResponse` lifecycle:

```js
const listener = hermes.getListener();
chrome.runtime.onMessage.addListener(listener);
```

Use `tabId` when the client must target a specific tab. Without it, the adapter uses `runtime.sendMessage`. Only the context that owns the handler map should install the router listener; multiple listeners should use HermesHandler ownership gates rather than racing to answer the same request.

## BroadcastChannel peers

BroadcastChannel has no dedicated server endpoint. Choose exactly one peer to dispatch request messages and send their response envelopes. Other peers use `createHermesClient()` normally. Multiple replying peers can race on the same `requestId`, so leader ownership must be explicit.

BroadcastChannel is same-origin delivery, not an authorization layer. Validate privileged payloads at the router boundary.

## Cleanup

`dispatch.close()` is terminal: it unsubscribes, settles pending requests, clears broadcast handlers, and prevents later sends. It does not terminate a Worker, close a MessagePort, or close a BroadcastChannel. The code that created those resources still owns them:

```js
dispatch.close();
port.close();
channel.close();
worker.terminate();
```

Keep the unsubscribe function returned by `servePostMessage()` or a raw transport subscription and call it during shutdown when the serving context remains alive. Worker termination releases listeners owned by that global context.

See [`examples/transports`](../examples/transports/) for focused integrations.
