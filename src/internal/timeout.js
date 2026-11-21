// The router bounds one handler invocation here. The client owns its timer
// alongside the abort listener and pending request in its settlement path.

/**
 * Run `fn` with an optional ms-bounded timeout. If the timeout fires
 * before `fn` resolves, the returned Promise rejects with
 * `onTimeout()`. Non-positive and non-finite durations disable the timer.
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
