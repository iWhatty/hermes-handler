# Cross-origin iframe transport

This example uses a small custom transport because cross-window messaging has two different endpoints:

- send to the remote `WindowProxy` (`iframe.contentWindow` or `window.parent`);
- subscribe on the local `window`.

`postMessageTransport(target)` intentionally models endpoints where sending and subscribing happen on the same object, so it is not used for this split.

Before using the example, replace the fixed origins in both files and run `parent.js` only after the iframe has loaded. The parent must control the iframe element and know its exact child URL. The child must know the exact embedding parent origin.

Security assumptions:

- Neither side uses `"*"` as `targetOrigin`.
- Every inbound event must match both `event.origin` and `event.source`.
- The `channel` discriminator separates application traffic but is not authentication.
- Both routers still validate and authorize privileged payloads.
- Sandboxed/opaque-origin frames (`origin === "null"`) need a different trust design and are outside this example.

`parent.js` creates a correlated Hermes client. `child.js` owns the router and replies only to requests carrying a `requestId`; messages without one are fire-and-forget. Both sides remove their local listeners during page teardown.
