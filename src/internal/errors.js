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
    try {
        if (err instanceof Error) {
            const message = err.message;
            if (typeof message === "string" && message.length > 0) return message;
            return String(err);
        }

        if (err && typeof err === "object" && "message" in err) {
            const msg = /** @type {{ message?: unknown }} */ (err).message;
            if (typeof msg === "string") return msg;
        }

        return String(err);
    } catch {
        return "Unknown error";
    }
}

/**
 * Invoke a diagnostic logger method without allowing logging failures to
 * change product behavior. Healthy methods retain their logger receiver.
 * @param {any} logger
 * @param {"info"|"warn"|"error"} method
 * @param {...any} args
 */
export function safeLog(logger, method, ...args) {
    try {
        const log = logger?.[method];
        if (typeof log === "function") Reflect.apply(log, logger, args);
    } catch { /* diagnostics are best-effort */ }
}
