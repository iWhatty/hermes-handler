// src/HermesHandler.js
//
// ------------------------------------------------------------
// HermesHandler  — universal message router / gatekeeper
// ------------------------------------------------------------
//
// Routing logic lives here. Wire-envelope normalization, timeout
// primitives, and error stringification have moved to
// `src/internal/` so the client (`src/client.js`) shares the same
// contract. Refactor history: helpers were inlined here through
// 1.0.0; 1.0.1 extracted the shared pieces.

import { normalizePayload, freezeNormalized } from "./internal/envelope.js";
import { withTimeout } from "./internal/timeout.js";
import { safeLog, toErrorString } from "./internal/errors.js";
import { setTransferList } from "./internal/transfer.js";


/**
 * @template T
 * @typedef {Object} HermesOk
 * @property {true} ok
 * @property {T} [result]
 */


/**
 * @typedef {Object} HermesErr
 * @property {false} ok
 * @property {string} error
 * @property {any} [info]
 */


/**
 * @template T
 * @typedef {HermesOk<T> | HermesErr} HermesResponse
 */


/**
 * @typedef {Object} HermesMessage
 * @property {string} type
 * @property {any} [payload]
 * @property {string} [requestId]  // optional correlation id
 */


/**
 * @typedef {Object} HermesContext
 * @property {any} sender
 * @property {number|undefined} tabId
 * @property {AbortSignal|undefined} signal
 * @property {string|undefined} requestId
 * @property {(payload: any) => void} send
 * @property {(...transferables: Transferable[]) => void} transfer
 *   Declare Transferables inside the response (ArrayBuffers, MessagePorts,
 *   ImageBitmaps, ...) that should MOVE to the caller instead of being
 *   structured-cloned. Honored by transfer-capable serving glue
 *   (`servePostMessage`); read via `getTransferList(envelope)` for
 *   hand-rolled transports; harmless elsewhere. Cumulative across calls
 *   within one dispatch.
 */


/**
 * Handler-return contract:
 *
 *   A handler MUST settle the response by one of:
 *     1. Returning a value (will be normalized — primitives become
 *        `{ ok: true, result: value }`; full `{ ok, result?, error? }`
 *        envelopes are accepted verbatim).
 *     2. Calling `ctx.send(payload)` synchronously OR asynchronously
 *        before its returned Promise settles.
 *
 *   Returning `undefined` WITHOUT calling `ctx.send` settles the
 *   dispatch with `{ ok: false, error: "Handler ${type} returned no
 *   response" }`. This is treated as a handler bug — explicit settle
 *   is part of the contract.
 *
 * @callback HermesHandlerFn
 * @param {HermesMessage} msg
 * @param {HermesContext} ctx
 * @returns {HermesResponse<any>|Promise<HermesResponse<any>>|any}
 */


/**
 * @callback HermesShouldHandleFn
 * @param {any} msg
 * @param {any} sender
 * @returns {boolean}
 */


/**
 * @typedef {Object} HermesLogger
 * @property {(message?: any, ...optionalParams: any[]) => void} [debug]
 * @property {(message?: any, ...optionalParams: any[]) => void} [info]
 * @property {(message?: any, ...optionalParams: any[]) => void} [warn]
 * @property {(message?: any, ...optionalParams: any[]) => void} [error]
 */



/* ------------------------------------------------------------
 * Local helpers (kept here because they're routing-specific)
 * ---------------------------------------------------------- */

/**
 * Type guard for callable values.
 *
 * @param {unknown} value
 * @returns {value is (...args: any[]) => any}
 */
function isFn(value) {
    return typeof value === "function";
}

/**
 * Read an untrusted message field without allowing an accessor or Proxy trap
 * to escape the router boundary. Inaccessible fields are treated as absent.
 * @param {any} msg
 * @param {string} key
 * @returns {any}
 */
function readMessageField(msg, key) {
    if (!msg || typeof msg !== "object") return undefined;
    try { return msg[key]; } catch { return undefined; }
}

/**
 * Derive optional sender metadata without allowing accessors or Proxy traps to
 * escape the router boundary. The raw sender is still passed through unchanged.
 * @param {any} sender
 * @returns {any}
 */
function readSenderTabId(sender) {
    try {
        const tab = sender?.tab;
        return tab?.id;
    } catch {
        return undefined;
    }
}

/**
 * Create best-effort cooperative cancellation state without allowing a broken
 * AbortController implementation to change dispatch settlement.
 * @returns {{ signal: AbortSignal|undefined, abort: () => void }}
 */
function createDispatchAbortContext() {
    let controller;
    try {
        if (typeof AbortController === "undefined") {
            return { signal: undefined, abort: () => {} };
        }
        controller = new AbortController();
    } catch {
        return { signal: undefined, abort: () => {} };
    }

    let signal;
    try { signal = controller.signal; } catch { signal = undefined; }

    return {
        signal,
        abort: () => {
            try { controller.abort(); } catch { /* cleanup is best-effort */ }
        },
    };
}
/**
 * Report a runtime-listener boundary failure without letting a custom logger
 * turn the defensive path into another thrown error.
 * @param {HermesLogger | null} logger
 * @param {string} message
 * @param {any} err
 */
function reportListenerError(logger, message, err) {
    safeLog(logger, "error", message, err);
}
/** @param {any} type */
function validateRouteName(type) {
    if (typeof type !== "string" || type.length === 0) {
        throw new TypeError("HermesHandler: route type must be a non-empty string");
    }
}


/**
 * @typedef {Object} HermesHandlerConfig
 * @property {HermesHandlerFn} handler  The function called for matching messages.
 * @property {number} [timeoutMs]  Per-handler timeout override (ms). Falls back to class-level `timeoutMs` if omitted. `0` disables timeout for this handler only.
 */

/**
 * Normalize an entry in the handler map. Bare functions become
 * `{ handler: fn }`. Object form is validated and passed through.
 * @param {string} type
 * @param {HermesHandlerFn | HermesHandlerConfig} entry
 * @returns {HermesHandlerConfig}
 */
function normalizeHandlerEntry(type, entry) {
    validateRouteName(type);
    if (isFn(entry)) return { handler: entry };
    if (entry && typeof entry === "object" && isFn(entry.handler)) {
        if (entry.timeoutMs !== undefined && (typeof entry.timeoutMs !== "number" || !Number.isFinite(entry.timeoutMs) || entry.timeoutMs < 0)) {
            throw new Error(`Handler config for ${type}: timeoutMs must be a non-negative finite number`);
        }
        return entry;
    }
    throw new Error(`Handler for ${type} must be a function or { handler, ...config } object`);
}


export class HermesHandler {
    /**
     * @param {Record<string, HermesHandlerFn | HermesHandlerConfig>} initialHandlers
     *   Map of msg.type to either a bare handler function or a config object
     *   `{ handler, timeoutMs? }`. Bare functions inherit the class-level
     *   timeout; object form lets each handler declare its own budget.
     * @param {Object} [options]
     * @param {number} [options.timeoutMs=5000]  default timeout (ms) for handlers without their own. Per-handler config overrides this.
     * @param {(msg: any, ctx: any) => any} [options.onUnknown]  override unknown-type response
     * @param {(err: any, msg: any, ctx: any) => any} [options.onError] override error response
     * @param {boolean} [options.ignoreUnknown=false]  let runtime listeners ignore messages without a registered handler
     * @param {HermesShouldHandleFn} [options.shouldHandle]  runtime-listener ownership predicate
     * @param {HermesLogger|null} [options.logger=console]  set to null to silence logs
     */
    constructor(initialHandlers = {}, options = {}) {
        if (!initialHandlers || typeof initialHandlers !== "object" || Array.isArray(initialHandlers)) {
            throw new TypeError("HermesHandler: initialHandlers must be an object map");
        }
        if (!options || typeof options !== "object" || Array.isArray(options)) {
            throw new TypeError("HermesHandler: options must be an object");
        }

        const {
            timeoutMs = 5000,
            onUnknown = (msg, _ctx) => ({ ok: false, error: `Unknown msg.type: ${msg?.type}` }),
            onError = (err) => ({ ok: false, error: toErrorString(err) }),
            ignoreUnknown = false,
            shouldHandle,
            logger = console
        } = options;

        if (typeof timeoutMs !== "number") {
            throw new TypeError("HermesHandler: timeoutMs must be a number");
        }
        if (!isFn(onUnknown)) {
            throw new TypeError("HermesHandler: onUnknown must be a function");
        }
        if (!isFn(onError)) {
            throw new TypeError("HermesHandler: onError must be a function");
        }
        if (typeof ignoreUnknown !== "boolean") {
            throw new TypeError("HermesHandler: ignoreUnknown must be a boolean");
        }
        if (shouldHandle !== undefined && !isFn(shouldHandle)) {
            throw new TypeError("HermesHandler: shouldHandle must be a function");
        }

        /** @type {Map<string, HermesHandlerConfig>} */
        this._handlers = new Map();
        for (const [type, entry] of Object.entries(initialHandlers)) {
            this._handlers.set(type, normalizeHandlerEntry(type, entry));
        }
        this._timeoutMs = timeoutMs;
        this._onUnknown = onUnknown;
        this._onError = onError;
        this._ignoreUnknown = ignoreUnknown === true;
        this._shouldHandle = isFn(shouldHandle) ? shouldHandle : null;

        /** @type {Array<(msg: any, ctx: any, next: () => Promise<any>) => any>} */
        this._middleware = [];

        /** @type {HermesLogger|null} */
        this._logger = logger;
    }


    /**
     * Register a middleware. Each middleware is called with
     * `(msg, ctx, next)` for every dispatched message, in registration
     * order. The middleware MUST either:
     *
     *   - return a response envelope (short-circuiting `next()`), OR
     *   - call `await next()` to invoke the rest of the chain (terminating
     *     in the actual handler) and return its result, optionally
     *     transformed
     *
     * Middlewares can: log, time, authenticate, rate-limit, retry,
     * transform input/output, emit metrics, etc. Throws are caught and
     * become error envelopes (same as handler throws).
     *
     * Order matters: middleware registered first wraps middleware
     * registered later (outermost first). The handler runs last.
     *
     * ```js
     * hermes.use(async (msg, ctx, next) => {
     *   const start = performance.now();
     *   const res = await next();
     *   console.info(`[hermes] ${msg.type} ${(performance.now() - start).toFixed(1)}ms ok=${res.ok}`);
     *   return res;
     * });
     * ```
     *
     * @param {(msg: any, ctx: any, next: () => Promise<any>) => any} fn
     * @returns {this}
     */
    use(fn) {
        if (!isFn(fn)) {
            throw new TypeError("HermesHandler.use: middleware must be a function (msg, ctx, next) => any");
        }
        this._middleware.push(fn);
        return this;
    }


    /**
     * Get a list of currently registered message types.
     *
     * The returned array reflects registration order (Map insertion order).
     * Useful for debugging, diagnostics, or validating integration boundaries.
     *
     * @returns {string[]} Array of registered message type strings.
     */
    types() {
        return [...this._handlers.keys()];
    }


    /**
     * Register (or overwrite) a handler for a given msg.type. Accepts a
     * bare function or a `{ handler, timeoutMs? }` config object.
     * @param {string} type
     * @param {HermesHandlerFn | HermesHandlerConfig} entry
     * @returns {void}
     */
    register(type, entry) {
        this._handlers.set(type, normalizeHandlerEntry(type, entry));
    }

    /**
     * Register multiple handlers at once. Same per-entry shape as `register`.
     * @param {Record<string, HermesHandlerFn | HermesHandlerConfig>} map
     * @returns {void}
     */
    registerMany(map) {
        for (const [type, entry] of Object.entries(map ?? {})) {
            this.register(type, entry);
        }
    }

    /** Remove a handler for a given msg.type */
    /** @param {string} type */
    unregister(type) {
        this._handlers.delete(type);
    }

    /** Check if a handler exists for a given msg.type */
    /** @param {string} type */
    has(type) {
        return this._handlers.has(type);
    }


    /**
    * The listener you add using browser.runtime.onMessage.addListener
    *
    * Supports BOTH reply styles:
    * • Promise-returning listener (Firefox / MV3 / polyfill)
    * • sendResponse + return true (callback-style)
    * @returns {(msg: any, sender: any, sendResponse?: (payload: any) => void) => any}
    */
    getListener() {
        return (msg, sender, sendResponse) => {
            const ownership = this._ownsMessage(msg, sender);
            if (!ownership) {
                return false;
            }

            const tabId = readSenderTabId(sender);
            const p = this._dispatch(msg, sender, typeof ownership === "string" ? ownership : undefined, tabId);


            // Callback-style (works everywhere)
            if (isFn(sendResponse)) {
                /** @param {any} response */
                const respond = (response) => {
                    try {
                        sendResponse(response);
                    } catch (err) {
                        reportListenerError(this._logger, "[Hermes] sendResponse error:", err);
                    }
                };

                p.then(
                    respond,
                    (err) => respond(
                        this._errorEnvelope(err, msg, { sender, tabId })
                    )
                );

                return true; // keep the port open for async response
            }




            // Promise-returning style
            return p;
        };
    }

    /**
     * Decide whether a runtime listener should claim this message.
     *
     * `dispatch()` intentionally bypasses this gate so direct callers keep the
     * deterministic Hermes response contract for invalid and unknown messages.
     *
     * @param {any} msg
     * @param {any} sender
     * @returns {boolean|string}
     */
    _ownsMessage(msg, sender) {
        if (this._shouldHandle) {
            try {
                return this._shouldHandle(msg, sender) === true;
            } catch (err) {
                reportListenerError(this._logger, "[Hermes] shouldHandle error:", err);
                return false;
            }
        }

        if (!this._ignoreUnknown) {
            return true;
        }

        const type = readMessageField(msg, "type");
        if (typeof type !== "string" || type.length === 0 || !this._handlers.has(type)) return false;
        return type;
    }

    /**
     * Invoke the user error hook without letting a broken hook reject dispatch.
     * @param {any} err
     * @param {any} msg
     * @param {any} ctx
     * @returns {HermesResponse<any>}
     */
    _errorEnvelope(err, msg, ctx) {
        const requestId = ctx?.requestId ?? readMessageField(msg, "requestId");
        try {
            return freezeNormalized(this._onError(err, msg, ctx), this._logger, requestId);
        } catch {
            return freezeNormalized(
                { ok: false, error: toErrorString(err) },
                this._logger,
                requestId
            );
        }
    }

    // ---- Core dispatch ------------------------------------------------------
    /**
     * @param {any} msg
     * @param {any} sender
     * @param {string} [ownedType] Type already validated by the listener ownership gate.
     * @param {any} [tabId] Safely derived sender tab ID.
     * @returns {Promise<HermesResponse<any>>}
     */
    async _dispatch(msg, sender, ownedType, tabId) {

        // Echo requestId from request → response so manual transports
        // (postMessage, MessageChannel, BroadcastChannel, …) get correlation
        // without hand-plumbing. Captured up here so all early-return paths
        // (invalid message, missing type, unknown handler) stamp it too.
        const reqId = readMessageField(msg, "requestId");

        if (!msg || typeof msg !== "object") {
            return freezeNormalized({ ok: false, error: "Invalid message: msg expected to be an object" }, this._logger, reqId);
        }

        const type = ownedType ?? readMessageField(msg, "type");

        if (typeof type !== "string" || !type) {
            return freezeNormalized({ ok: false, error: "Invalid message: msg missing string 'type'" }, this._logger, reqId);
        }



        let responded = false;

        /** @type {HermesResponse<any>} */
        let payloadToReturn = freezeNormalized({ ok: false, error: "No response" }, this._logger, reqId);


        // Cooperative cancellation: handlers MAY honor ctx.signal
        const abortContext = createDispatchAbortContext();

        /** @type {Transferable[]} */
        const transferables = [];

        const ctx = {
            sender,
            tabId: arguments.length >= 4 ? tabId : readSenderTabId(sender),
            signal: abortContext.signal,
            requestId: reqId,
            send: (/** @type {any} */payload) => {
                if (responded) {
                    safeLog(this._logger, "warn", "[Hermes] Multiple send attempts", { type });
                    return;
                }

                responded = true;

                // Freeze to prevent accidental mutation after responding
                // (shallow freeze is enough and avoids surprising perf hits).
                payloadToReturn = freezeNormalized(payload, this._logger, reqId);

            },
            // Collect Transferables for the response. The list rides
            // OUTSIDE the (frozen) envelope in a WeakMap — see
            // internal/transfer.js — and is registered against the final
            // envelope just before _dispatch returns.
            transfer: (/** @type {Transferable[]} */ ...items) => {
                for (const item of items) {
                    if (item != null) transferables.push(item);
                }
            }

        };

        // Terminal handler invocation: looks up the handler, runs it with
        // the appropriate per-handler timeout, returns a NORMALIZED response
        // envelope so middlewares see canonical `{ ok, result?, error?, info?,
        // requestId? }` from `next()`. ctx.send is honored if the handler
        // used it. Throws become onError envelopes.
        const handlerInvocation = async () => {
            const entry = this._handlers.get(type);
            if (!entry) return normalizePayload(this._onUnknown(msg, ctx), this._logger);

            // Per-handler timeout overrides class-level. `0` disables for this
            // handler. Undefined falls back to class default.
            const effectiveTimeout = entry.timeoutMs !== undefined ? entry.timeoutMs : this._timeoutMs;

            try {
                const maybeReturn = await withTimeout(
                    () => entry.handler(msg, ctx),
                    effectiveTimeout,
                    () => new Error(`Handler ${type} timed out (${effectiveTimeout} ms)`)
                );
                if (responded) return payloadToReturn;  // handler used ctx.send
                if (maybeReturn === undefined) {
                    return { ok: false, error: `Handler ${type} returned no response` };
                }
                return normalizePayload(maybeReturn, this._logger);
            } catch (err) {
                safeLog(this._logger, "error", `[Hermes] Handler error for ${type}:`, err);
                if (responded) return payloadToReturn;
                return this._errorEnvelope(err, msg, ctx);
            }
        };

        // Compose middleware chain: middleware registered first wraps
        // middleware registered later, with handlerInvocation as the
        // innermost call. Each middleware is `(msg, ctx, next) => response`.
        let chain = handlerInvocation;
        for (let i = this._middleware.length - 1; i >= 0; i--) {
            const mw = this._middleware[i];
            const inner = chain;
            chain = async () => {
                try {
                    return await mw(msg, ctx, inner);
                } catch (err) {
                    safeLog(this._logger, "error", `[Hermes] Middleware error for ${type}:`, err);
                    return this._errorEnvelope(err, msg, ctx);
                }
            };
        }

        try {
            const chainResponse = await chain();
            // If the chain returned a value (typical), normalize+send it.
            // If the handler used ctx.send (responded=true) without the
            // chain returning, payloadToReturn already holds it.
            if (!responded && chainResponse !== undefined) {
                ctx.send(chainResponse);
            }
            if (!responded) {
                ctx.send({ ok: false, error: `Chain for ${type} returned no response` });
            }
        } catch (err) {
            // Defensive: chain shouldn't throw (middleware/handler errors
            // are caught above), but if it does we want a clean envelope.
            safeLog(this._logger, "error", `[Hermes] Dispatch chain error for ${type}:`, err);
            if (!responded) {
                ctx.send(this._errorEnvelope(err, msg, ctx));
            }
        } finally {
            // NOTE: Abort does not stop JS execution, but lets handlers cooperate.
            abortContext.abort();
        }

        // Associate collected Transferables with the final envelope so
        // serving glue can pass them to postMessage. Error envelopes get
        // them too: if the handler transferred before throwing, the
        // buffers are spoken for either way.
        if (transferables.length > 0) {
            setTransferList(payloadToReturn, transferables);
        }

        return payloadToReturn;
    }


    /**
     * Dispatch a message through the router (useful for testing / non-runtime environments).
     * @param {HermesMessage} msg
     * @param {any} [sender]
     * @returns {Promise<HermesResponse<any>>}
     */
    dispatch(msg, sender) {
        return this._dispatch(msg, sender, undefined, readSenderTabId(sender));
    }



}
