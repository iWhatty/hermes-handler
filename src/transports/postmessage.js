// src/transports/postmessage.js
//
// Transport adapter for `window.postMessage` style messaging. Plugs into
// `createHermesClient` from `hermes-handler/client`.
//
// Common shapes this covers:
//   - Page-world ↔ content-script bridges (iframe-style same-window)
//   - Parent ↔ child iframe communication
//   - Worker ↔ main thread (postMessage-compatible)
//
// Discriminators (optional): if the same postMessage stream carries
// unrelated traffic, attach a `source` field to outbound messages and
// require it on inbound. Both `outbound` and `inbound` are merged onto
// the canonical envelope; missing values aren't enforced.
//
// Usage:
//
//   import { createHermesClient } from 'hermes-handler/client';
//   import { postMessageTransport } from 'hermes-handler/transports/postmessage';
//
//   const dispatch = createHermesClient(
//     postMessageTransport(window, {
//       outbound: { source: 'app-page' },
//       inbound:  { source: 'app-extension' },
//     })
//   );
//
// To use on the server side, mirror by reading the discriminator off
// inbound traffic and posting responses with the outbound one.

/**
 * @typedef {Object} PostMessageTransportOptions
 * @property {Record<string, any>} [outbound]
 *   Fields merged onto every outbound message (alongside the canonical
 *   `{ type, payload, requestId }` envelope).
 * @property {Record<string, any>} [inbound]
 *   Fields the inbound message must match. If any key disagrees, the
 *   message is dropped silently. Useful for filtering out cross-extension
 *   chatter on `window.postMessage`.
 * @property {string} [targetOrigin='*']
 *   `window.postMessage` targetOrigin. Defaults to '*' (matches the
 *   pre-adapter manual usage). Restrict in production.
 * @property {(MessageEvent: any) => boolean} [filter]
 *   Extra inbound predicate. Returns true to accept. Composes with
 *   `inbound`.
 */

/**
 * @param {any} target  Window, MessagePort, Worker, or anything with postMessage + addEventListener.
 * @param {PostMessageTransportOptions} [opts]
 */
export function postMessageTransport(target, opts = {}) {
    const { outbound = {}, inbound = {}, targetOrigin = "*", filter } = opts;
    const inboundKeys = Object.keys(inbound);

    if (!target || typeof target.postMessage !== "function") {
        throw new TypeError("postMessageTransport: target must have postMessage()");
    }
    if (typeof target.addEventListener !== "function") {
        throw new TypeError("postMessageTransport: target must have addEventListener()");
    }

    // Window#postMessage takes (msg, targetOrigin). MessagePort/Worker take
    // just (msg). Window has a `location` property; MessagePort doesn't.
    // Cache the branch at construction time so send() stays hot.
    const isWindow = "location" in target || target === globalThis;

    /** @param {any} msg */
    const send = (msg) => {
        const enveloped = { ...outbound, ...msg };
        if (isWindow) {
            target.postMessage(enveloped, targetOrigin);
        } else {
            target.postMessage(enveloped);
        }
    };

    /** @param {(msg: any) => void} handler */
    const subscribe = (handler) => {
        /** @param {any} event */
        const listener = (event) => {
            // For same-window page↔content bridges, require event.source ===
            // target so we don't pick up our own outbound messages.
            if (event.source !== undefined && event.source !== target && event.source !== globalThis) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            for (const k of inboundKeys) {
                if (data[k] !== inbound[k]) return;
            }
            if (filter && !filter(event)) return;
            // Strip the inbound discriminator keys before passing the
            // canonical envelope to the client (it filters by requestId).
            if (inboundKeys.length === 0) {
                handler(data);
            } else {
                const canonical = { ...data };
                for (const k of inboundKeys) delete canonical[k];
                handler(canonical);
            }
        };
        target.addEventListener("message", listener);
        return () => target.removeEventListener("message", listener);
    };

    return { send, subscribe };
}
