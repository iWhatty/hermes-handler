# Transport Examples

These dependency-free ESM examples use published HermesHandler subpaths:

- `postmessage-worker-main.js` + `postmessage-worker-server.js`: Worker request/reply, timeouts, transfer lists, and cleanup.
- `postmessage-messagechannel.js`: in-process `MessagePort` request/reply.
- `chrome-client.js` + `chrome-background.js`: Chrome client/router listener ownership.
- `broadcast-peer.js`: an explicitly owned BroadcastChannel responder and client.

They are small integration sketches. Apply application-specific origin checks, authorization, logging, and lifecycle ownership before production use. See [`docs/TRANSPORTS.md`](../../docs/TRANSPORTS.md).
