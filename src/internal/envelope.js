// src/internal/envelope.js
//
// Wire envelope contract — single source of truth for both the router
// side (HermesHandler) and the client side (createHermesClient).
//
// Canonical envelope:
//
//   request:    { type, payload?, requestId? }
//   response:   { ok: true,  result?, info?, requestId? }
//               { ok: false, error,   info?, requestId? }
//   broadcast:  { type, payload? }                       ← no requestId
//
// Both sides validate against this shape. The router NORMALIZES
// outgoing responses (raw handler returns → canonical shape); the
// client PARSES incoming responses (wire shape → typed envelope for
// the dispatch resolver).

// ============================================================================
// Canonical key sets
// ============================================================================

/** Full set of fields the canonical envelope reserves. */
export const HERMES_KEYS = new Set(["ok", "result", "error", "info", "requestId"]);

/** Subset of canonical fields valid on `ok:true` responses. */
export const HERMES_KEYS_SUCCESS = new Set(["ok", "result", "info", "requestId"]);

/** Subset of canonical fields valid on `ok:false` responses. */
export const HERMES_KEYS_ERROR = new Set(["ok", "error", "info", "requestId"]);

// ============================================================================
// Idempotency marker
// ============================================================================

// Middleware pipelines normalize at handlerInvocation so the chain sees
// canonical envelopes; ctx.send then normalizes again. Without this
// marker, the second pass would re-shunt `info` into `info.handlerInfo`
// recursively. Symbol so it never collides with user keys;
// non-enumerable so it stays out of Object.keys / JSON / for-in.
export const NORMALIZED_MARKER = Symbol("hermes:normalized");

/**
 * @param {any} obj
 * @returns {boolean}
 */
export function isNormalized(obj) {
    return obj != null && typeof obj === "object" && obj[NORMALIZED_MARKER] === true;
}

/**
 * @param {object} obj
 */
function markNormalized(obj) {
    Object.defineProperty(obj, NORMALIZED_MARKER, { value: true, enumerable: false });
}

// ============================================================================
// Info collection: shunt non-canonical fields into an `info` bag
// ============================================================================

/**
 * Collect non-canonical fields from a payload into an `info` bag.
 * Handler-set `info` becomes `info.handlerInfo` so router-side fields
 * stay distinguishable from handler-supplied ones.
 *
 * @param {any} payload
 * @param {ReadonlySet<string> | readonly string[]} skipKeys
 * @returns {Record<string, any> | null}
 */
function collectInfo(payload, skipKeys) {
    const skip = skipKeys instanceof Set ? skipKeys : new Set(skipKeys);

    /** @type {Record<string, any> | null} */
    let info = null;

    /** @param {string} k @param {any} v */
    const addInfo = (k, v) => {
        if (v === undefined) return;
        if (info === null) info = {};
        info[k] = v;
    };

    if ("info" in payload) addInfo("handlerInfo", payload.info);

    for (const [k, v] of Object.entries(payload)) {
        if (skip.has(k)) continue;
        addInfo(k, v);
    }

    return info;
}

// ============================================================================
// Normalization (router side: raw handler return → canonical envelope)
// ============================================================================

/**
 * Normalize a handler return value into a canonical HermesResponse.
 *
 * Goals:
 *  - Accept primitives, partial envelopes, and well-formed envelopes
 *  - Always emit a deterministic `{ ok: true, result?, ... } | { ok: false, error, ... }`
 *  - Preserve handler-set extra fields under `info.handlerInfo` instead of dropping them
 *  - Idempotent: calling twice produces the same output (via NORMALIZED_MARKER)
 *
 * @param {any} payload
 * @param {import("../types").HermesLogger | null} [logger]
 * @returns {{ ok: true, result?: any, info?: any, requestId?: string } | { ok: false, error: string, info?: any, requestId?: string }}
 */
export function normalizePayload(payload, logger = null) {
    // Idempotency short-circuit.
    if (isNormalized(payload)) {
        return payload;
    }

    // Non-envelope return → wrap as ok:true with the value as result.
    if (!payload || typeof payload !== "object" || !("ok" in payload)) {
        /** @type {{ ok: true, result?: any }} */
        const out = { ok: true, result: payload };
        markNormalized(out);
        return out;
    }

    // Malformed: `ok` exists but isn't a boolean.
    if (typeof payload.ok !== "boolean") {
        const out = { ok: false, error: "Invalid response: 'ok' must be boolean" };
        markNormalized(out);
        return out;
    }

    // Error envelope.
    if (payload.ok === false) {
        if (typeof payload.error !== "string") {
            const out = { ok: false, error: "Invalid response: missing 'error' string" };
            markNormalized(out);
            return out;
        }

        const info = collectInfo(payload, HERMES_KEYS_ERROR);

        /** @type {{ ok: false, error: string, info?: any, requestId?: string }} */
        const errOut = { ok: false, error: payload.error };
        if ("requestId" in payload) errOut.requestId = payload.requestId;
        if (info) {
            logger?.warn?.("[Hermes] ok:false response contained extra fields; preserved in info", {
                extraKeys: Object.keys(info)
            });
            errOut.info = info;
        }
        markNormalized(errOut);
        return errOut;
    }

    // Success envelope.
    /** @type {{ ok: true, result?: any, info?: any, requestId?: string }} */
    const out = { ok: true };
    if ("result" in payload) out.result = payload.result;
    if ("requestId" in payload) out.requestId = payload.requestId;

    const info = collectInfo(payload, HERMES_KEYS_SUCCESS);
    if (info) {
        logger?.warn?.("[Hermes] ok:true response contained extra fields; preserved in info", {
            extraKeys: Object.keys(info)
        });
        out.info = info;
    }

    markNormalized(out);
    return out;
}

/**
 * Normalize, optionally stamp `requestId`, then shallow-freeze.
 *
 * The router uses this on every dispatch return path so manual
 * transports (postMessage, BroadcastChannel, MessageChannel, ...)
 * inherit requestId correlation without hand-plumbing it. The
 * chrome.runtime path via `getListener()` doesn't strictly need it
 * (callback transport correlates by sendResponse handle) but stamps
 * it anyway for consistency.
 *
 * If the handler already set `requestId` on the response, the
 * handler's value wins (collected via `normalizePayload` first).
 *
 * @param {any} payload
 * @param {import("../types").HermesLogger | null} [logger]
 * @param {string | undefined} [requestId]
 */
export function freezeNormalized(payload, logger = null, requestId = undefined) {
    const normalized = normalizePayload(payload, logger);
    if (
        normalized &&
        typeof normalized === "object" &&
        requestId !== undefined &&
        !("requestId" in normalized)
    ) {
        /** @type {any} */ (normalized).requestId = requestId;
    }
    return normalized && typeof normalized === "object"
        ? Object.freeze(normalized)
        : normalized;
}

// ============================================================================
// Parsing (client side: inbound wire message → typed envelope)
// ============================================================================

/**
 * @typedef {{ ok: true, result?: any, info?: any }} HermesClientOk
 * @typedef {{ ok: false, error: string, info?: any }} HermesClientErr
 * @typedef {HermesClientOk | HermesClientErr} HermesClientEnvelope
 */

/**
 * Parse an incoming wire message into a canonical client-side envelope.
 * Used by `createHermesClient` when a dispatch response arrives.
 *
 * Returns one of:
 *   - { ok: true, result?, info? }                     ← well-formed success
 *   - { ok: false, error, info? }                      ← well-formed error
 *   - { ok: false, error: "...malformed...", info: {...} }   ← shape violation
 *
 * @param {any} msg
 * @param {{ requestId?: string, type?: string }} [ctx]  Optional info for malformed-response diagnostics
 * @returns {HermesClientEnvelope}
 */
export function parseWireResponse(msg, ctx = {}) {
    if (msg && msg.ok === true) {
        /** @type {HermesClientOk} */
        const r = { ok: true };
        if ("result" in msg) r.result = msg.result;
        if (msg.info !== undefined) r.info = msg.info;
        return r;
    }
    if (msg && msg.ok === false && typeof msg.error === "string") {
        /** @type {HermesClientErr} */
        const r = { ok: false, error: msg.error };
        if (msg.info !== undefined) r.info = msg.info;
        return r;
    }
    return {
        ok: false,
        error: "Hermes client: malformed response from server",
        info: { received: msg, ...ctx },
    };
}
