// src/internal/wire.js
//
// Client-side wire parsing — kept separate from envelope.js's
// router-side normalization so the client bundle doesn't pull in
// the marker Symbol, key sets, collectInfo, normalize, and freeze
// helpers (~4 KB gz of router-only code that the client never
// references but a single shared module can't tree-shake away).
//
// Router and client share the wire CONTRACT (same envelope shape);
// they don't share the IMPLEMENTATION (router produces, client
// consumes).

/**
 * @typedef {{ ok: true, result?: any, info?: any }} HermesClientOk
 * @typedef {{ ok: false, error: string, info?: any }} HermesClientErr
 * @typedef {HermesClientOk | HermesClientErr} HermesClientEnvelope
 */

/**
 * Parse an incoming wire message into a canonical client-side envelope.
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
