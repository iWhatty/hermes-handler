// src/internal/timeout.js
//
// Promise-with-timeout primitive shared across the router. `ms <= 0`
// or non-finite values disable the timeout entirely (handler runs
// untimed, just awaited).
//
// The client (`createHermesClient`) does NOT use this helper because
// its timeout lifecycle is intermingled with the dispatch settle/
// abort/unsubscribe state machine — refactoring it into a shared
// helper would tangle three different cleanup concerns.

/**
 * Run `fn` with an optional ms-bounded timeout. If the timeout fires
 * before `fn` resolves, the returned Promise rejects with
 * `onTimeout()`. If `ms` is 0 or non-finite, no timeout is imposed.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {number} ms
 * @param {() => any} onTimeout
 * @returns {Promise<T>}
 */
export function withTimeout(fn, ms, onTimeout) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return Promise.resolve().then(fn);
    }

    const makeTimeoutError = () => {
        try {
            return onTimeout();
        } catch (e) {
            return e;
        }
    };

    return new Promise((resolve, reject) => {
        /** @type {ReturnType<typeof setTimeout>|null} */
        let timerId = null;
        const cleanup = () => {
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
        };
        /** @param {T} v */
        const resolveWithCleanup = (v) => {
            cleanup();
            resolve(v);
        };
        /** @param {any} err */
        const rejectWithCleanup = (err) => {
            cleanup();
            reject(err);
        };

        timerId = setTimeout(() => rejectWithCleanup(makeTimeoutError()), ms);

        Promise.resolve()
            .then(fn)
            .then(resolveWithCleanup)
            .catch(rejectWithCleanup);
    });
}
