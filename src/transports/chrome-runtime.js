// src/transports/chrome-runtime.js
//
// Transport adapter for `chrome.runtime.sendMessage` / `onMessage` style
// messaging in WebExtensions. Plugs into `createHermesClient` from
// `hermes-handler/client`.
//
// Note: the WebExtension runtime correlates request/response via
// sendResponse callback handles, so on the *router* side prefer
// `hermes.getListener()` directly with `browser.runtime.onMessage.addListener`.
// This adapter is for cases where the *client* side wants to use the
// same dispatch API as other transports.
//
// Usage:
//
//   import { createHermesClient } from 'hermes-handler/client';
//   import { chromeRuntimeTransport } from 'hermes-handler/transports/chrome-runtime';
//
//   const dispatch = createHermesClient(
//     chromeRuntimeTransport({ tabId: someTabId })  // omit tabId for runtime.sendMessage
//   );

/**
 * @typedef {Object} ChromeRuntimeTransportOptions
 * @property {number} [tabId]
 *   If set, messages go to `chrome.tabs.sendMessage(tabId, ...)`. Otherwise
 *   they go to `chrome.runtime.sendMessage(...)` (background SW or other
 *   extension contexts).
 * @property {any} [runtime]
 *   Inject a custom runtime (defaults to `globalThis.browser ?? globalThis.chrome`).
 *   Useful for tests.
 */

/**
 * @param {ChromeRuntimeTransportOptions} [opts]
 */
export function chromeRuntimeTransport(opts = {}) {
    const { tabId, runtime } = opts;
    const g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    const r = runtime ?? g.browser ?? g.chrome;
    if (!r || !r.runtime) {
        throw new Error("chromeRuntimeTransport: no chrome/browser runtime available");
    }

    /** @type {Set<(msg: any) => void>} */
    const handlers = new Set();
    let listenerAttached = false;
    /** @type {((msg: any) => void) | null} */
    let attachedListener = null;

    const ensureListener = () => {
        if (listenerAttached) return;
        /** @param {any} msg */
        attachedListener = (msg) => {
            for (const h of handlers) h(msg);
        };
        r.runtime.onMessage.addListener(attachedListener);
        listenerAttached = true;
    };

    /** @param {any} msg */
    const send = (msg) => {
        // sendMessage returns a Promise (Manifest V3 browser.* / chrome.* with
        // returns-promise polyfill). For each dispatch, the response is the
        // sendResponse callback value — we feed it into every subscribed
        // handler so the hermes client matches by requestId.
        /** @param {any} responseOrUndef */
        const apply = (responseOrUndef) => {
            if (responseOrUndef === undefined) return;
            for (const h of handlers) h(responseOrUndef);
        };
        try {
            const p = (tabId !== undefined && r.tabs && typeof r.tabs.sendMessage === "function")
                ? r.tabs.sendMessage(tabId, msg)
                : r.runtime.sendMessage(msg);
            if (p && typeof p.then === "function") {
                p.then(apply).catch(() => { /* swallow — client times out */ });
            }
        } catch {
            // Runtime may be unavailable mid-reload; the client times out.
        }
    };

    /** @param {(msg: any) => void} handler */
    const subscribe = (handler) => {
        handlers.add(handler);
        ensureListener();
        return () => handlers.delete(handler);
    };

    return { send, subscribe };
}
