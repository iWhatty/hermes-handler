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
//   request:   { type, payload?, requestId }
//   response:  { ok: true,  result?, info?, requestId }
//              { ok: false, error,   info?, requestId }
//
// You provide the transport (`send` and `subscribe`); the client handles
// requestId correlation, timeout, AbortSignal, and envelope normalization.
//
// Half-and-half is fine and often correct: server-side HermesHandler,
// client-side createHermesClient. The wire shape is the contract; the
// class is one implementation of it.

/**
 * @typedef {Object} HermesClientRequest
 * @property {string} type
 * @property {any} [payload]
 * @property {number} [timeoutMs]  Per-call override of the client default. 0 disables.
 * @property {AbortSignal} [signal]
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
 * @property {(msg: HermesClientWireOut) => void} send
 *   Called once per dispatch. Fire-and-forget; replies arrive via `subscribe`.
 *   Throwing here resolves the dispatch with an error envelope (does not throw).
 * @property {(handler: (msg: any) => void) => () => void} subscribe
 *   Subscribe to incoming messages from the server. The handler is called with
 *   every incoming message; the client filters by `requestId` itself. Must
 *   return an unsubscribe function.
 * @property {number} [defaultTimeoutMs=5000]
 *   Default timeout in ms applied to each dispatch unless overridden. Set to
 *   0 (or any non-positive number) to disable by default.
 * @property {() => string} [idGen]
 *   Optional requestId generator. Default produces `hermes-{timestamp}-{n}`.
 */

let _counter = 0;
function defaultIdGen() {
    _counter = (_counter + 1) | 0;
    return `hermes-${Date.now()}-${_counter}`;
}

/**
 * Create a Hermes client function bound to a specific transport.
 *
 * @param {CreateHermesClientOptions} opts
 * @returns {(req: HermesClientRequest) => Promise<HermesClientResponse<any>>}
 */
export function createHermesClient({ send, subscribe, defaultTimeoutMs = 5000, idGen = defaultIdGen }) {
    if (typeof send !== "function") {
        throw new TypeError("createHermesClient: `send` must be a function");
    }
    if (typeof subscribe !== "function") {
        throw new TypeError("createHermesClient: `subscribe` must be a function");
    }

    return function dispatch({ type, payload, timeoutMs, signal } = /** @type {HermesClientRequest} */ ({})) {
        if (typeof type !== "string" || type.length === 0) {
            return Promise.resolve(/** @type {HermesClientResponse<any>} */ ({
                ok: false,
                error: "Hermes client: request.type must be a non-empty string",
            }));
        }

        return new Promise((resolve) => {
            const requestId = idGen();
            const effectiveTimeout = timeoutMs ?? defaultTimeoutMs;

            /** @type {ReturnType<typeof setTimeout>|null} */
            let timeoutHandle = null;
            /** @type {(() => void)|null} */
            let unsubscribe = null;
            /** @type {(() => void)|null} */
            let signalHandler = null;
            let settled = false;

            /** @param {HermesClientResponse<any>} response */
            const settle = (response) => {
                if (settled) return;
                settled = true;
                if (timeoutHandle !== null) clearTimeout(timeoutHandle);
                if (unsubscribe) unsubscribe();
                if (signal && signalHandler) signal.removeEventListener("abort", signalHandler);
                resolve(response);
            };

            unsubscribe = subscribe((msg) => {
                if (!msg || typeof msg !== "object") return;
                if (msg.requestId !== requestId) return;

                if (msg.ok === true) {
                    /** @type {HermesClientResponse<any>} */
                    const r = { ok: true };
                    if ("result" in msg) r.result = msg.result;
                    if (msg.info !== undefined) r.info = msg.info;
                    settle(r);
                    return;
                }

                if (msg.ok === false && typeof msg.error === "string") {
                    /** @type {HermesClientResponse<any>} */
                    const r = { ok: false, error: msg.error };
                    if (msg.info !== undefined) r.info = msg.info;
                    settle(r);
                    return;
                }

                settle({
                    ok: false,
                    error: "Hermes client: malformed response from server",
                    info: { received: msg, requestId },
                });
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
                if (signal.aborted) {
                    settle({ ok: false, error: "Aborted", info: { aborted: true, requestId } });
                    return;
                }
                signalHandler = () => {
                    settle({ ok: false, error: "Aborted", info: { aborted: true, requestId } });
                };
                signal.addEventListener("abort", signalHandler, { once: true });
            }

            try {
                send({ type, payload, requestId });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                settle({
                    ok: false,
                    error: `Hermes client: send failed (${message})`,
                    info: { requestId, type },
                });
            }
        });
    };
}
