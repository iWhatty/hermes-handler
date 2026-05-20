// src/internal/errors.js
//
// Shared error helpers used by both HermesHandler.js (router) and
// client.js. Single-source-of-truth so the two sides agree on how to
// stringify throws + structured errors.

/**
 * Convert unknown error-like values into a readable string. Handles
 * native Error, things with a `message` field (DOMException-style),
 * and falls back to String() for everything else.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function toErrorString(err) {
    if (err instanceof Error) {
        return err.message || String(err);
    }

    if (err && typeof err === "object" && "message" in err) {
        const msg = /** @type {{ message?: unknown }} */ (err).message;
        if (typeof msg === "string") return msg;
    }

    return String(err);
}
