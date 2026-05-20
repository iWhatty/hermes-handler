import { describe, it, expect } from "vitest";
import { chromeRuntimeTransport } from "../../src/transports/chrome-runtime.js";

function makeFakeRuntime() {
    const listeners = new Set();
    return {
        runtime: {
            onMessage: {
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
            },
            sendMessage: (msg) => {
                // Simulate the runtime callback: feed the message back to all
                // subscribed handlers (which is how chrome.runtime works under
                // promise-returning Manifest V3).
                return Promise.resolve({ ok: true, result: "echo:" + msg.type, requestId: msg.requestId });
            },
        },
        _fanout: (responseLike) => {
            for (const l of listeners) l(responseLike);
        },
    };
}

describe("chromeRuntimeTransport", () => {
    it("uses runtime.sendMessage by default and routes responses to subscribers", async () => {
        const runtime = makeFakeRuntime();
        const transport = chromeRuntimeTransport({ runtime });

        const received = [];
        transport.subscribe((msg) => received.push(msg));

        transport.send({ type: "ping", requestId: "r1" });
        await new Promise((r) => setTimeout(r, 0));

        expect(received).toEqual([{ ok: true, result: "echo:ping", requestId: "r1" }]);
    });

    it("uses tabs.sendMessage when tabId is supplied", async () => {
        const sent = [];
        const runtime = {
            runtime: { onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage: () => {} },
            tabs: { sendMessage: (tabId, msg) => { sent.push([tabId, msg]); return Promise.resolve(); } },
        };

        const transport = chromeRuntimeTransport({ tabId: 42, runtime });
        transport.send({ type: "go", requestId: "r" });
        await new Promise((r) => setTimeout(r, 0));

        expect(sent).toEqual([[42, { type: "go", requestId: "r" }]]);
    });

    it("throws when no runtime is available", () => {
        expect(() => chromeRuntimeTransport({ runtime: null })).toThrow(/runtime/);
    });
});
