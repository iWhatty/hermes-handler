// src/guard.js
//
// `hermes-handler/guard`: per-boundary message names, sender kinds and
// refusals. Dependency-free and independent of HermesHandler; it only
// produces values HermesHandler accepts (a handler map, a middleware).
// It never reads `msg.payload`, never logs, and keeps no global state.

/**
 * A row in a boundary's rule table. Extra keys (e.g. `feature`) belong to the
 * extension and are handed to `gate` untouched.
 * @typedef {{ from?: string | string[], timeoutMs?: number, port?: boolean, [meta: string]: unknown }} Rule
 */

/**
 * @typedef {Readonly<{
 *   label: string,
 *   types: readonly string[],
 *   has(type: unknown): boolean,
 *   owns(msg: unknown): boolean,
 *   rule(type: string): Rule | undefined,
 *   allows(type: string, kind: string | null): boolean,
 *   pair<H extends Record<string, (...args: any[]) => any>>(handlers: H):
 *     Record<string, H[keyof H] | { handler: H[keyof H], timeoutMs: number }>,
 * }>} Boundary
 */

/**
 * @typedef {{ ok: false, error: string, info: { code: 'UNKNOWN_TYPE' | 'SENDER_REFUSED', type: string } }} Refusal
 */

/**
 * @typedef {'extension' | `extension:${string}` | 'page'} SenderKind
 */

/** @type {Rule} */
const NO_RULE = Object.freeze({});

/**
 * Throw one error naming every offending type, grouped by problem.
 * @param {string} label
 * @param {Array<[string, string[]]>} groups
 */
const fail = (label, groups) => {
    const parts = groups.filter((g) => g[1].length).map(([what, list]) => `${what}: ${list.join(", ")}`);
    if (parts.length) throw new Error(`Boundary ${label}: ${parts.join("; ")}`);
};

/**
 * Declare one message boundary: the wire values it accepts and, optionally,
 * one rule per value. Rule objects are kept by reference (not copied, frozen
 * or mutated), so `rule(type)` returns the caller's own row.
 *
 * @param {string} label  Used only in error messages.
 * @param {Record<string, string> | readonly string[]} names  Wire values, as an array or a `{ KEY: 'wire' }` map.
 * @param {{ rules?: Record<string, Rule>, trusted?: string }} [options]
 * @returns {Boundary}
 */
export function defineBoundary(label, names, options = {}) {
    const { rules, trusted } = options;
    if (!names || typeof names !== "object") throw new TypeError(`Boundary ${label}: names must be an array or an object`);
    const types = Object.freeze([...(Array.isArray(names) ? names : Object.values(names))]);

    /** @type {Map<string, Rule>} */
    const map = new Map();
    /** @type {string[]} */
    const dup = [];
    for (const t of types) {
        if (typeof t !== "string" || !t) throw new TypeError(`Boundary ${label}: message names must be non-empty strings`);
        if (map.has(t)) dup.push(t);
        map.set(t, NO_RULE);
    }
    fail(label, [["duplicate wire values", dup]]);

    if (rules !== undefined) {
        const keys = Object.keys(rules);
        fail(label, [
            ["no rule for", types.filter((t) => !keys.includes(t))],
            ["rule for undeclared", keys.filter((k) => !map.has(k))],
        ]);
        for (const k of keys) {
            const row = rules[k];
            if (!row || typeof row !== "object") throw new TypeError(`Boundary ${label}: rule for ${k} must be an object`);
            map.set(k, row);
        }
    }

    return Object.freeze({
        label,
        types,
        has: (/** @type {unknown} */ type) => map.has(/** @type {string} */ (type)),
        owns: (/** @type {unknown} */ msg) =>
            !!msg && typeof msg === "object" && map.has(/** @type {any} */ (msg).type),
        rule: (/** @type {string} */ type) => map.get(type),
        allows(/** @type {string} */ type, /** @type {string | null} */ kind) {
            const row = map.get(type);
            if (!row || typeof kind !== "string" || !kind) return false;
            /** @param {string} f */
            const matches = (f) => f === kind || kind.startsWith(f + ":");
            if (trusted && matches(trusted)) return true;
            const from = row.from ?? "any";
            return (Array.isArray(from) ? from : [from]).some((f) => f === "any" || matches(f));
        },
        /**
         * @template {Record<string, (...args: any[]) => any>} H
         * @param {H} handlers
         */
        pair(handlers) {
            const own = Object.keys(handlers);
            /** @type {string[]} */
            const missing = [];
            /** @type {string[]} */
            const port = [];
            /** @type {Record<string, any>} */
            const out = {};
            for (const t of types) {
                const row = /** @type {Rule} */ (map.get(t));
                const h = own.includes(t) ? handlers[t] : undefined;
                if (row.port) {
                    if (own.includes(t)) port.push(t);
                } else if (typeof h !== "function") {
                    missing.push(t);
                } else {
                    out[t] = row.timeoutMs !== undefined ? { handler: h, timeoutMs: row.timeoutMs } : h;
                }
            }
            fail(label, [
                ["no handler function for", missing],
                ["handler for undeclared", own.filter((k) => !map.has(k))],
                ["handler for port", port],
            ]);
            return out;
        },
    });
}

/**
 * Classify a runtime sender. Reads only `url`, `id` and `tab`; never throws.
 *
 * @param {unknown} sender
 * @param {{ origin: string, id?: string, pages?: Record<string, string> }} options
 *   `origin` is `runtime.getURL('')` and must end with `/` (otherwise every
 *   sender is `null`). `pages` maps a name to a path: `{ popup: '/popup.html' }`.
 * @returns {SenderKind | null}
 */
export function classifySender(sender, options) {
    try {
        const { origin, id, pages } = options;
        if (!sender || typeof sender !== "object" || typeof origin !== "string" || !origin.endsWith("/")) return null;
        const s = /** @type {{ url?: unknown, id?: unknown, tab?: unknown }} */ (sender);
        const url = typeof s.url === "string" ? s.url : "";
        if (url.startsWith(origin)) {
            if (id != null && s.id != null && s.id !== id) return null;
            const path = "/" + url.slice(origin.length).split(/[?#]/)[0];
            const name = Object.keys(pages || {}).find((k) => /** @type {Record<string, string>} */ (pages)[k] === path);
            return name ? `extension:${name}` : "extension";
        }
        return s.tab || url ? "page" : null;
    } catch {
        return null;
    }
}

/**
 * @param {'UNKNOWN_TYPE' | 'SENDER_REFUSED'} code
 * @param {string} error
 * @param {string} type
 * @returns {Refusal}
 */
const refusal = (code, error, type) => ({ ok: false, error, info: { code, type } });

/**
 * Build a guard for one boundary. `check` refuses in a fixed order: undeclared
 * type, sender not allowed, then whatever `gate` returns (as given).
 *
 * @param {Boundary} boundary
 * @param {(sender: unknown) => string | null} classify
 * @param {{ gate?: (rule: Rule, info: { type: string, kind: string, sender: unknown, msg?: unknown }) => object | null | undefined }} [options]
 * @returns {{
 *   check(type: string, sender: unknown, msg?: unknown): Refusal | object | null,
 *   middleware(msg: any, ctx: { sender?: unknown }, next: () => Promise<any>): Promise<any>,
 * }}
 */
export function createGuard(boundary, classify, options = {}) {
    const { gate } = options;
    /**
     * @param {string} type
     * @param {unknown} sender
     * @param {unknown} [msg]
     */
    const check = (type, sender, msg) => {
        if (!boundary.has(type)) return refusal("UNKNOWN_TYPE", `Unknown msg.type: ${String(type)}`, type);
        const kind = classify(sender);
        if (!kind || !boundary.allows(type, kind)) {
            return refusal("SENDER_REFUSED", `${type} is not accepted from this sender.`, type);
        }
        return (gate && gate(/** @type {Rule} */ (boundary.rule(type)), { type, kind, sender, msg })) || null;
    };
    return {
        check,
        middleware: async (msg, ctx, next) => check(msg.type, ctx.sender, msg) ?? next(),
    };
}
