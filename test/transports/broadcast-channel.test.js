import { describe, it, expect } from "vitest";
import { broadcastChannelTransport } from "../../src/transports/broadcast-channel.js";

// Tiny BroadcastChannel polyfill for the test
class FakeBroadcastChannel {
    static channels = new Map();
    constructor(name) {
        this.name = name;
        this.listeners = new Set();
        if (!FakeBroadcastChannel.channels.has(name)) {
            FakeBroadcastChannel.channels.set(name, new Set());
        }
        FakeBroadcastChannel.channels.get(name).add(this);
    }
    postMessage(data) {
        for (const peer of FakeBroadcastChannel.channels.get(this.name)) {
            if (peer === this) continue;
            for (const l of peer.listeners) l({ data });
        }
    }
    addEventListener(_evt, fn) { this.listeners.add(fn); }
    removeEventListener(_evt, fn) { this.listeners.delete(fn); }
    close() {
        FakeBroadcastChannel.channels.get(this.name).delete(this);
    }
}

describe("broadcastChannelTransport", () => {
    it("relays messages between two transports on the same channel name", async () => {
        const a = broadcastChannelTransport("test", { Channel: FakeBroadcastChannel });
        const b = broadcastChannelTransport("test", { Channel: FakeBroadcastChannel });

        const received = [];
        b.subscribe((msg) => received.push(msg));
        a.send({ type: "hello", requestId: "x" });

        await Promise.resolve();
        expect(received).toEqual([{ type: "hello", requestId: "x" }]);

        a.channel.close();
        b.channel.close();
    });

    it("accepts a pre-constructed channel instance", () => {
        const ch = new FakeBroadcastChannel("preconstructed");
        const transport = broadcastChannelTransport(ch);
        expect(transport.channel).toBe(ch);
        ch.close();
    });

    it("throws when no Channel constructor is available", () => {
        // Hide the global so the fallback fails too.
        const orig = globalThis.BroadcastChannel;
        delete globalThis.BroadcastChannel;
        try {
            expect(() => broadcastChannelTransport("name")).toThrow(/BroadcastChannel/);
        } finally {
            globalThis.BroadcastChannel = orig;
        }
    });
});
