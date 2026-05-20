// src/transports/broadcast-channel.js
//
// Transport adapter for `BroadcastChannel`. Plugs into `createHermesClient`
// from `hermes-handler/client`.
//
// Use case: pages/workers within the same origin coordinating without a
// dedicated server endpoint. Both sides connect to the same named channel.
//
// Usage:
//
//   import { createHermesClient } from 'hermes-handler/client';
//   import { broadcastChannelTransport } from 'hermes-handler/transports/broadcast-channel';
//
//   const dispatch = createHermesClient(broadcastChannelTransport('my-app'));

/**
 * @typedef {Object} BroadcastChannelTransportOptions
 * @property {typeof BroadcastChannel} [Channel]
 *   Inject a constructor (defaults to `globalThis.BroadcastChannel`). Useful
 *   for tests.
 */

/**
 * @param {string | BroadcastChannel} channelOrName
 * @param {BroadcastChannelTransportOptions} [opts]
 */
export function broadcastChannelTransport(channelOrName, opts = {}) {
    const Channel = opts.Channel ?? (typeof globalThis !== "undefined" ? globalThis.BroadcastChannel : undefined);
    let channel;
    if (typeof channelOrName === "string") {
        if (!Channel) {
            throw new Error("broadcastChannelTransport: no BroadcastChannel constructor available");
        }
        channel = new Channel(channelOrName);
    } else {
        channel = channelOrName;
    }

    /** @param {any} msg */
    const send = (msg) => channel.postMessage(msg);

    /** @param {(msg: any) => void} handler */
    const subscribe = (handler) => {
        /** @param {any} event */
        const listener = (event) => handler(event.data);
        channel.addEventListener("message", listener);
        return () => channel.removeEventListener("message", listener);
    };

    return { send, subscribe, channel };
}
