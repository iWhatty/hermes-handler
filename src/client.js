// src/client.js
//
// Lightweight client-side helper for the Hermes wire envelope.
//
// HermesHandler (the class in ./HermesHandler.js) is the **router** — what
// you run on the side that owns the handlers (background SW, content
// script, parent process, etc.).
//
// This module is the **client** — what you run on the side that sends a
// request and parses the response envelope. It does not include any of
// the routing, registration, or per-handler timeout machinery, so it is
// dramatically smaller than the full class. Use this in page-world
// bundles, popup bundles, or any context where every byte counts.
//
// The wire envelope is the contract:
//
//   dispatch request:    { type, payload?, requestId }
//   dispatch response:   { ok: true,  result?, info?, requestId }
//                        { ok: false, error,   info?, requestId }
//   broadcast (server→client, no reply expected):
//                        { type, payload? }     ← no requestId
//
// You provide the transport (`send` and `subscribe`); the client handles
// requestId correlation for dispatches AND fans out broadcasts to
// type-keyed subscribers registered via `.on(type, handler)`.
//
// The wire shape is the contract; the class is one implementation of it.

import { parseWireResponse } from "./internal/wire.js";
import { toErrorString } from "./internal/errors.js";

/**
 * @typedef {Object} HermesClientRequest
 * @property {string} type
 * @property {any} [payload]
 * @property {number} [timeoutMs]  Per-call override. Non-positive or non-finite numbers disable the timeout.
 * @property {AbortSignal} [signal]
 * @property {Transferable[]} [transfer]
 *   Transferable objects inside `payload` (ArrayBuffers, MessagePorts,
 *   ImageBitmaps, ...) to move rather than structured-clone. Forwarded as
 *   the transport's second `send` argument. Transports over channels that
 *   can't transfer (chrome.runtime, BroadcastChannel) ignore it — the
 *   payload still arrives, via copy. After a transferring send, the
 *   buffers are neutered on the sending side; don't reuse them.
 */

/**
 * @typedef {Object} HermesClientWireOut
 * @property {string} type
 * @property {any} [payload]
 * @property {string} requestId
 */

/**
 * @template T
 * @typedef {{ ok: true, result?: T, info?: any } | { ok: false, error: string, info?: any }} HermesClientResponse
 */

/**
 * @typedef {Object} CreateHermesClientOptions
 * @property {(msg: any, transfer?: Transferable[]) => void | PromiseLike<void>} send
 *   Called once per dispatch. Fire-and-forget; replies arrive via `subscribe`.
 *   Throwing here resolves the dispatch with an error envelope (does not throw).
 *   The second argument carries the request's transfer list when one was
 *   provided; transports that can't transfer may ignore it.
 * @property {(handler: (msg: any) => void) => () => void} subscribe
 *   Subscribe to incoming messages from the server. Called ONCE at client
 *   construction; the client routes messages internally (by `requestId` for
 *   dispatches; by `type` for broadcasts). Must return an unsubscribe
 *   function that the client invokes on `.close()`.
 * @property {number} [defaultTimeoutMs=5000]
 *   Default timeout in ms applied to each dispatch unless overridden. Set to
 *   0, a negative number, or a non-finite number to disable by default.
 * @property {() => string} [idGen]
 *   Optional requestId generator. Default produces `hermes-{timestamp}-{n}`.
 */

/**
 * @typedef {((req: HermesClientRequest) => Promise<HermesClientResponse<any>>) & {
 *   on: (type: string, handler: (payload: any, msg: any) => void) => () => void,
 *   off: (type: string, handler: (payload: any, msg: any) => void) => void,
 *   close: () => void
 * }} HermesClient
 */

let _counter = 0;
function defaultIdGen() {
    _counter = (_counter + 1) | 0;
    return `hermes-${Date.now()}-${_counter}`;
}

/**
 * Create a Hermes client function bound to a specific transport.
 *
 * The returned value is callable as `dispatch(req)` for request/response,
 * AND carries `.on(type, handler)` / `.off(type, handler)` / `.close()` for
 * server-initiated broadcasts.
 *
 * @param {CreateHermesClientOptions} opts
 * @returns {HermesClient}
 */
export function createHermesClient(opts) {
    if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
        throw new TypeError("createHermesClient: options must be an object");
    }

    const { send, subscribe, defaultTimeoutMs = 5000, idGen = defaultIdGen } = opts;
    if (typeof send !== "function") {
        throw new TypeError("createHermesClient: `send` must be a function");
    }
    if (typeof subscribe !== "function") {
        throw new TypeError("createHermesClient: `subscribe` must be a function");
    }
    if (typeof defaultTimeoutMs !== "number") {
        throw new TypeError("createHermesClient: `defaultTimeoutMs` must be a number");
    }
    if (typeof idGen !== "function") {
        throw new TypeError("createHermesClient: `idGen` must be a function");
    }

    /** @type {Map<string, { onWireResponse: (msg: any) => void, close: () => void }>} */
    const pending = new Map();

    /** @type {Map<string, Set<(payload: any, msg: any) => void>>} */
    const broadcastHandlers = new Map();

    let closed = false;

    /**
     * @param {Record<string, any>} [info]
     * @returns {HermesClientResponse<any>}
     */
    const closedResponse = (info) => {
        const response = /** @type {HermesClientResponse<any>} */ ({
            ok: false,
            error: "Hermes client: client is closed",
            info: { closed: true },
        });
        if (info) Object.assign(response.info, info);
        return response;
    };

    // Single persistent transport subscription. Fans out by requestId (for
    // dispatch responses) or by type (for broadcasts).
    /** @type {(() => void)|null} */
    let unsubscribeTransport = subscribe((msg) => {
        if (closed || !msg || typeof msg !== "object") return;

        let requestId;
        try { requestId = msg.requestId; } catch { return; }
        if (typeof requestId === "string") {
            const entry = pending.get(requestId);
            if (entry) entry.onWireResponse(msg);
            return;
        }

        let type;
        try { type = msg.type; } catch { return; }
        if (typeof type === "string") {
            const handlers = broadcastHandlers.get(type);
            if (handlers && handlers.size > 0) {
                let payload;
                try { payload = msg.payload; } catch { return; }
                for (const h of handlers) {
                    try { h(payload, msg); } catch { /* swallow per-handler */ }
                }
            }
        }
    });

    if (typeof unsubscribeTransport !== "function") {
        throw new TypeError("createHermesClient: `subscribe` must return an unsubscribe function");
    }
    /**
     * @param {HermesClientRequest} [req]
     * @returns {Promise<HermesClientResponse<any>>}
     */
    function dispatch(req) {
        if (closed) return Promise.resolve(closedResponse());

        let request;
        let type;
        try {
            request = req || /** @type {HermesClientRequest} */ ({});
            type = request.type;
        } catch (err) {
            return Promise.resolve(/** @type {HermesClientResponse<any>} */ ({
                ok: false,
                error: `Hermes client: request fields could not be read (${toErrorString(err)})`,
            }));
        }

        if (typeof type !== "string" || type.length === 0) {
            return Promise.resolve(/** @type {HermesClientResponse<any>} */ ({
                ok: false,
                error: "Hermes client: request.type must be a non-empty string",
            }));
        }

        let payload;
        let timeoutMs;
        let signal;
        let transfer;
        try {
            payload = request.payload;
            timeoutMs = request.timeoutMs;
            signal = request.signal;
            transfer = request.transfer;
        } catch (err) {
            return Promise.resolve(/** @type {HermesClientResponse<any>} */ ({
                ok: false,
                error: `Hermes client: request fields could not be read (${toErrorString(err)})`,
            }));
        }

        if (timeoutMs != null && typeof timeoutMs !== "number") {
            return Promise.resolve(/** @type {HermesClientResponse<any>} */ ({
                ok: false,
                error: "Hermes client: request.timeoutMs must be a number",
            }));
        }
        return new Promise((resolve) => {
            let requestId;
            try {
                requestId = idGen();
            } catch (err) {
                const message = toErrorString(err);
                resolve({
                    ok: false,
                    error: `Hermes client: requestId generation failed (${message})`,
                    info: { type },
                });
                return;
            }

            if (typeof requestId !== "string" || requestId.length === 0) {
                resolve({
                    ok: false,
                    error: "Hermes client: idGen must return a non-empty string",
                    info: { type },
                });
                return;
            }

            if (pending.has(requestId)) {
                resolve({
                    ok: false,
                    error: "Hermes client: duplicate requestId",
                    info: { requestId, type },
                });
                return;
            }

            const effectiveTimeout = timeoutMs ?? defaultTimeoutMs;

            /** @type {ReturnType<typeof setTimeout>|null} */
            let timeoutHandle = null;
            /** @type {(() => void)|null} */
            let signalHandler = null;
            let settled = false;

            /** @param {HermesClientResponse<any>} response */
            const settle = (response) => {
                if (settled) return;
                settled = true;
                pending.delete(requestId);
                if (timeoutHandle !== null) clearTimeout(timeoutHandle);
                if (signal && signalHandler) {
                    try { signal.removeEventListener("abort", signalHandler); }
                    catch { /* cleanup failure must not prevent settlement */ }
                }
                resolve(response);
            };

            /** @param {any} msg */
            const onWireResponse = (msg) => {
                settle(/** @type {HermesClientResponse<any>} */ (parseWireResponse(msg, { requestId })));
            };

            pending.set(requestId, {
                onWireResponse,
                close: () => settle(closedResponse({ requestId, type })),
            });

            if (effectiveTimeout > 0 && Number.isFinite(effectiveTimeout)) {
                timeoutHandle = setTimeout(() => {
                    settle({
                        ok: false,
                        error: `Hermes client: timeout after ${effectiveTimeout}ms`,
                        info: { timeout: true, requestId, type },
                    });
                }, effectiveTimeout);
            }

            if (signal) {
                try {
                    if (signal.aborted) {
                        settle({ ok: false, error: "Aborted", info: { aborted: true, requestId } });
                        return;
                    }
                    signalHandler = () => {
                        settle({ ok: false, error: "Aborted", info: { aborted: true, requestId } });
                    };
                    signal.addEventListener("abort", signalHandler, { once: true });
                } catch (err) {
                    settle({
                        ok: false,
                        error: `Hermes client: AbortSignal setup failed (${toErrorString(err)})`,
                        info: { requestId, type },
                    });
                    return;
                }
            }
            if (settled) return;

            const onSendFailure = (err) => {
                const message = toErrorString(err);
                settle({
                    ok: false,
                    error: `Hermes client: send failed (${message})`,
                    info: { requestId, type },
                });
            };

            try {
                const sendResult = send({ type, payload, requestId }, transfer);
                if (sendResult !== undefined) {
                    const observed = Promise.resolve(sendResult);
                    Promise.prototype.then.call(observed, undefined, onSendFailure);
                }
            } catch (err) {
                onSendFailure(err);
            }
        });
    }

    /**
     * Subscribe to server-initiated broadcasts of a given type. Returns an
     * unsubscribe function. Multiple handlers per type are supported. After
     * `.close()`, valid calls remain harmless no-ops and return a no-op
     * unsubscribe function so cleanup code can stay unconditional.
     * @param {string} type
     * @param {(payload: any, msg: any) => void} handler
     * @returns {() => void}
     */
    dispatch.on = function on(type, handler) {
        if (typeof type !== "string" || type.length === 0) {
            throw new TypeError("dispatch.on: type must be a non-empty string");
        }
        if (typeof handler !== "function") {
            throw new TypeError("dispatch.on: handler must be a function");
        }
        if (closed) return () => {};
        let set = broadcastHandlers.get(type);
        if (!set) {
            set = new Set();
            broadcastHandlers.set(type, set);
        }
        set.add(handler);
        return () => {
            const s = broadcastHandlers.get(type);
            if (!s) return;
            s.delete(handler);
            if (s.size === 0) broadcastHandlers.delete(type);
        };
    };

    /**
     * Unsubscribe a previously-registered broadcast handler. Equivalent to
     * calling the unsubscribe function returned by `.on()`, but accepts the
     * (type, handler) pair for symmetry with addEventListener.
     * @param {string} type
     * @param {(payload: any, msg: any) => void} handler
     */
    dispatch.off = function off(type, handler) {
        const s = broadcastHandlers.get(type);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) broadcastHandlers.delete(type);
    };

    /**
     * Tear down the transport subscription. After calling `.close()`, the
     * client is terminal: pending dispatches resolve with a closed-client
     * envelope, and future dispatches do not touch the transport. Idempotent.
     */
    dispatch.close = function close() {
        if (closed) return;
        closed = true;

        const unsubscribe = unsubscribeTransport;
        unsubscribeTransport = null;
        try {
            unsubscribe?.();
        } finally {
            broadcastHandlers.clear();
            for (const entry of [...pending.values()]) entry.close();
        }
    };

    return /** @type {HermesClient} */ (/** @type {unknown} */ (dispatch));
}
