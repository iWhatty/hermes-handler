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

import { defineTransport } from "./_base.js";
import { getTransferList, setTransferList } from "../internal/transfer.js";

/**
 * Attach and activate a MessagePort-shaped endpoint transactionally. If setup
 * fails, remove the newly-added listener and preserve the original error even
 * when rollback also fails.
 * @param {any} endpoint
 * @param {(event: any) => void} listener
 * @returns {() => void}
 */
function subscribeToMessages(endpoint, listener) {
    try {
        endpoint.addEventListener("message", listener);
        if (typeof endpoint.start === "function") endpoint.start();
    } catch (setupError) {
        try { endpoint.removeEventListener("message", listener); } catch { /* preserve setupError */ }
        throw setupError;
    }
    return () => endpoint.removeEventListener("message", listener);
}

/**
 * Send one message using the overload supported by the endpoint shape.
 * Window endpoints receive a target origin, while workers and ports receive
 * the optional transfer list as their second argument.
 * @param {any} endpoint
 * @param {any} message
 * @param {string} targetOrigin
 * @param {Transferable[]|undefined} transfer
 * @param {boolean} isWindow
 */
function postMessageToEndpoint(endpoint, message, targetOrigin, transfer, isWindow) {
    const hasTransfer = Array.isArray(transfer) && transfer.length > 0;
    if (isWindow) {
        if (hasTransfer) endpoint.postMessage(message, targetOrigin, transfer);
        else endpoint.postMessage(message, targetOrigin);
    } else if (hasTransfer) {
        endpoint.postMessage(message, transfer);
    } else {
        endpoint.postMessage(message);
    }
}

/**
 * Check the discriminator fields attached to an inbound message.
 * @param {any} data
 * @param {Record<string, any>} inbound
 * @param {string[]} inboundKeys
 * @returns {boolean}
 */
function matchesInboundDiscriminators(data, inbound, inboundKeys) {
    for (const key of inboundKeys) {
        if (data[key] !== inbound[key]) return false;
    }
    return true;
}

/**
 * Remove transport-only discriminator fields before handing a message to the
 * client or router. Preserve the original object when there is nothing to do.
 * @param {any} data
 * @param {string[]} inboundKeys
 * @returns {any}
 */
function stripInboundDiscriminators(data, inboundKeys) {
    if (inboundKeys.length === 0) return data;
    const canonical = { ...data };
    for (const key of inboundKeys) delete canonical[key];
    return canonical;
}

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

    /**
     * @param {any} msg
     * @param {Transferable[]} [transfer]
     */
    const send = (msg, transfer) => {
        const enveloped = { ...outbound, ...msg };
        postMessageToEndpoint(target, enveloped, targetOrigin, transfer, isWindow);
    };

    /** @param {(msg: any) => void} handler */
    const subscribe = (handler) => {
        /** @param {any} event */
        const listener = (event) => {
            // For same-window page↔content bridges, require event.source ===
            // target so we don't pick up our own outbound messages. Messages
            // from Workers and MessagePorts arrive with source === null (per
            // spec — there's no WindowProxy to attribute them to), so a null
            // source must pass: it can never be same-window echo.
            if (event.source != null && event.source !== target && event.source !== globalThis) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (!matchesInboundDiscriminators(data, inbound, inboundKeys)) return;
            if (filter && !filter(event)) return;
            handler(stripInboundDiscriminators(data, inboundKeys));
        };
        // MessagePort only begins dispatching addEventListener listeners after
        // start(). Window and Worker-style endpoints do not expose it.
        return subscribeToMessages(target, listener);
    };

    return defineTransport("postMessageTransport", { send, subscribe });
}

/**
 * @typedef {Object} ServePostMessageOptions
 * @property {Record<string, any>} [outbound]
 *   Fields merged onto every outbound response envelope.
 * @property {Record<string, any>} [inbound]
 *   Fields an inbound request must match; mismatches are dropped
 *   silently. Mirror of `postMessageTransport`'s discriminators.
 * @property {string} [targetOrigin='*']
 *   Window#postMessage targetOrigin for responses. Restrict in production.
 * @property {(event: any) => boolean} [filter]
 *   Extra inbound predicate. Returns true to accept.
 */

/**
 * Serve a HermesHandler over a postMessage endpoint — the router-side
 * mirror of `postMessageTransport`. Listens for canonical
 * `{ type, payload, requestId }` requests, dispatches through the
 * router, and posts the response envelope back with the requestId the
 * client correlates on. Messages WITHOUT a requestId are dispatched
 * fire-and-forget (no response posted).
 *
 * Typical worker-side usage (module worker):
 *
 *   import { HermesHandler } from 'hermes-handler';
 *   import { servePostMessage } from 'hermes-handler/transports/postmessage';
 *
 *   const hermes = new HermesHandler({
 *     resize: { timeoutMs: 0, handler: (msg, ctx) => {
 *       const out = heavyResize(msg.payload);       // ImageData-shaped
 *       ctx.transfer(out.data.buffer);              // zero-copy reply
 *       return { ok: true, result: out };
 *     } },
 *   });
 *   servePostMessage(hermes, self);
 *
 * Responses honor transfer lists declared via `ctx.transfer(...)` in
 * the handler (see HermesHandler) — the listed buffers MOVE to the
 * client instead of being structured-cloned.
 *
 * @param {{ dispatch: (msg: any, sender?: any) => Promise<any> }} hermes
 *   A HermesHandler (or anything dispatch-shaped).
 * @param {any} endpoint  Worker global (`self`), Worker, MessagePort, or
 *   Window — anything with postMessage + addEventListener.
 * @param {ServePostMessageOptions} [opts]
 * @returns {() => void}  Unsubscribe function.
 */
export function servePostMessage(hermes, endpoint, opts = {}) {
    const { outbound = {}, inbound = {}, targetOrigin = "*", filter } = opts;
    const inboundKeys = Object.keys(inbound);

    if (!hermes || typeof hermes.dispatch !== "function") {
        throw new TypeError("servePostMessage: hermes must have dispatch()");
    }
    if (!endpoint || typeof endpoint.postMessage !== "function" || typeof endpoint.addEventListener !== "function") {
        throw new TypeError("servePostMessage: endpoint must have postMessage() + addEventListener()");
    }

    // Window#postMessage takes (msg, targetOrigin[, transfer]); everything
    // else (worker global, Worker, MessagePort) takes (msg[, transfer]).
    // NOTE: can't reuse the client transport's `"location" in target` probe —
    // worker globals have a WorkerLocation, so it false-positives there.
    // `document` exists only on real Windows.
    const isWindow = (typeof Window !== "undefined" && endpoint instanceof Window) || "document" in endpoint;

    /**
     * @param {any} envelope
     * @param {Transferable[]} transfer
     */
    const reply = (envelope, transfer) => {
        const enveloped = inboundKeys.length === 0 && Object.keys(outbound).length === 0
            ? envelope
            : { ...outbound, ...envelope };
        postMessageToEndpoint(endpoint, enveloped, targetOrigin, transfer, isWindow);
    };

    /** @param {any} event */
    const listener = (event) => {
        const data = event.data;
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;
        // Ignore response envelopes echoing on a shared channel (e.g. a
        // worker global where our own replies also fire 'message' locally
        // in some test harnesses): requests never carry `ok`.
        if ("ok" in data) return;
        if (!matchesInboundDiscriminators(data, inbound, inboundKeys)) return;
        if (filter && !filter(event)) return;

        const msg = stripInboundDiscriminators(data, inboundKeys);

        let dispatchPromise;
        try {
            dispatchPromise = Promise.resolve(hermes.dispatch(msg, { endpoint, event }));
        } catch (err) {
            if (msg.requestId !== undefined) {
                reply({
                    ok: false,
                    error: `servePostMessage: dispatch threw (${err instanceof Error ? err.message : String(err)})`,
                    requestId: msg.requestId,
                }, []);
            }
            return;
        }

        if (msg.requestId === undefined) {
            // Dispatch still runs for fire-and-forget messages, but any
            // rejection belongs to the serving boundary and must be consumed.
            dispatchPromise.catch(() => {});
            return;
        }

        dispatchPromise.then((envelope) => {
            let correlated = envelope;
            if (
                envelope &&
                typeof envelope === "object" &&
                !("requestId" in envelope)
            ) {
                const transfer = getTransferList(envelope);
                correlated = { ...envelope, requestId: msg.requestId };
                setTransferList(correlated, transfer);
            }
            reply(correlated, getTransferList(correlated));
        }, (err) => {
            // Defensive: HermesHandler.dispatch resolves error envelopes
            // rather than rejecting, but a dispatch-shaped stand-in might not.
            reply({
                ok: false,
                error: `servePostMessage: dispatch rejected (${err instanceof Error ? err.message : String(err)})`,
                requestId: msg.requestId,
            }, []);
        });
    };

    // See postMessageTransport.subscribe(): real MessagePorts need explicit
    // activation when their listeners were registered with addEventListener.
    return subscribeToMessages(endpoint, listener);
}
