// Parse server replies for the client. Keeping this module independent from
// router-side normalization keeps the client entry point small.

/**
 * @typedef {{ ok: true, result?: any, info?: any }} HermesClientOk
 * @typedef {{ ok: false, error: string, info?: any }} HermesClientErr
 * @typedef {HermesClientOk | HermesClientErr} HermesClientEnvelope
 */

/**
 * Parse an incoming wire message into a canonical client-side envelope.
 * The caller has already used the wire requestId to find the pending request.
 * Returns one of:
 *   - `{ ok: true, result?, info? }`              ← well-formed success
 *   - `{ ok: false, error, info? }`               ← well-formed error
 *   - `{ ok: false, error: "…malformed…", info }` ← shape violation
 *
 * @param {any} msg
 * @param {{ requestId?: string, type?: string }} [ctx]  Diagnostics info attached on malformed responses.
 * @returns {HermesClientEnvelope}
 */
export function parseWireResponse(msg, ctx = {}) {
    try {
        const ok = msg && msg.ok;
        if (ok === true) {
            /** @type {HermesClientOk} */
            const r = { ok: true };
            if ("result" in msg) r.result = msg.result;
            const info = msg.info;
            if (info !== undefined) r.info = info;
            return r;
        }
        if (ok === false) {
            const error = msg.error;
            if (typeof error === "string") {
                /** @type {HermesClientErr} */
                const r = { ok: false, error };
                const info = msg.info;
                if (info !== undefined) r.info = info;
                return r;
            }
        }
    } catch {
        // A malformed object may expose throwing getters/proxy traps. Treat it
        // like any other shape violation so correlated requests still settle.
    }

    return {
        ok: false,
        error: "Hermes client: malformed response from server",
        info: { received: msg, ...ctx },
    };
}
