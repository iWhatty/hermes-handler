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
// Field collection: shunt non-canonical fields into `info` or `result`
// ============================================================================

/**
 * Collect fields from a payload that are not part of the given canonical key set.
 *
 * @param {any} payload
 * @param {ReadonlySet<string> | readonly string[]} skipKeys
 * @returns {Record<string, any> | null}
 */
function collectExtraFields(payload, skipKeys) {
    const skip = skipKeys instanceof Set ? skipKeys : new Set(skipKeys);

    /** @type {Record<string, any>} */
    const extras = {};

    for (const [k, v] of Object.entries(payload)) {
        if (skip.has(k)) continue;
        if (v !== undefined) extras[k] = v;
    }

    return Object.keys(extras).length > 0 ? extras : null;
}

/**
 * Collect non-canonical fields from an error payload into an `info` bag.
 * Handler-set `info` stays canonical unless extras force a combined bag.
 *
 * @param {any} payload
 * @returns {{ info: any, extraKeys: string[] }}
 */
function collectErrorInfo(payload) {
    const extras = collectExtraFields(payload, HERMES_KEYS_ERROR);
    const extraKeys = Object.keys(extras ?? {});

    if (extraKeys.length === 0) {
        return {
            info: "info" in payload ? payload.info : undefined,
            extraKeys
        };
    }

    if ("info" in payload && payload.info !== undefined) {
        return {
            info: {
                handlerInfo: payload.info,
                ...extras
            },
            extraKeys
        };
    }

    return {
        info: extras,
        extraKeys
    };
}

/**
 * Collect non-canonical fields from an explicit-result success payload into
 * `info`. Handler `info` stays canonical unless extras force a combined bag.
 *
 * @param {any} payload
 * @returns {any}
 */
function collectSuccessInfo(payload) {
    const extras = collectExtraFields(payload, HERMES_KEYS_SUCCESS);

    if (!extras) {
        return "info" in payload ? payload.info : undefined;
    }

    if ("info" in payload && payload.info !== undefined) {
        return {
            handlerInfo: payload.info,
            ...extras
        };
    }

    return extras;
}

/**
 * Collect diagnostics for success shorthand payloads. Non-reserved fields become
 * `result`; reserved fields from the wrong envelope branch stay diagnostic.
 *
 * @param {any} payload
 * @returns {any}
 */
function collectSuccessShorthandInfo(payload) {
    /** @type {Record<string, any> | null} */
    let diagnostics = null;

    if ("error" in payload && payload.error !== undefined) {
        diagnostics = { error: payload.error };
    }

    if (!diagnostics) {
        return "info" in payload ? payload.info : undefined;
    }

    if ("info" in payload && payload.info !== undefined) {
        return {
            handlerInfo: payload.info,
            ...diagnostics
        };
    }

    return diagnostics;
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
 *  - Preserve handler-set diagnostics under `info` instead of dropping them
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

        const { info, extraKeys } = collectErrorInfo(payload);

        /** @type {{ ok: false, error: string, info?: any, requestId?: string }} */
        const errOut = { ok: false, error: payload.error };
        if ("requestId" in payload) errOut.requestId = payload.requestId;
        if (info !== undefined) {
            if (extraKeys.length > 0) {
                logger?.warn?.("[Hermes] ok:false response contained extra fields; preserved in info", {
                    extraKeys
                });
            }
            errOut.info = info;
        }
        markNormalized(errOut);
        return errOut;
    }

    // Success envelope.
    /** @type {{ ok: true, result?: any, info?: any, requestId?: string }} */
    const out = { ok: true };
    if ("requestId" in payload) out.requestId = payload.requestId;

    if ("result" in payload) {
        out.result = payload.result;

        const info = collectSuccessInfo(payload);
        if (info !== undefined) {
            const extraKeys = Object.keys(collectExtraFields(payload, HERMES_KEYS_SUCCESS) ?? {});
            if (extraKeys.length > 0) {
                logger?.warn?.("[Hermes] ok:true response contained extra fields; preserved in info", {
                    extraKeys
                });
            }
            out.info = info;
        }

        markNormalized(out);
        return out;
    }

    const result = collectExtraFields(payload, HERMES_KEYS);
    if (result) {
        out.result = result;
    }

    const info = collectSuccessShorthandInfo(payload);
    if (info !== undefined) {
        if ("error" in payload && payload.error !== undefined) {
            logger?.warn?.("[Hermes] ok:true response contained error field; preserved in info");
        }
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

// NOTE: parseWireResponse (the inverse of normalize, used on the
// client side to parse incoming wire messages) lives in
// `./wire.js` — kept separate so client bundles don't pull in
// this module's normalize + marker + key sets (~4 KB gz that
// tree-shaking can't strip when the modules share a file).
