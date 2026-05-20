import { describe, it, expect } from "vitest";
import { postMessageTransport } from "../../src/transports/postmessage.js";
import { createHermesClient } from "../../src/client.js";
import { HermesHandler } from "../../src/HermesHandler.js";

// Minimal MessagePort-like fake — exercises the transport without a real
// browser environment.
function makeFakePort() {
    const listeners = new Set();
    let peer = null;
    return {
        postMessage(data) {
            if (!peer) return;
            for (const l of peer.listeners) l({ data });
        },
        addEventListener(_evt, fn) { listeners.add(fn); },
        removeEventListener(_evt, fn) { listeners.delete(fn); },
        listeners,
        connect(other) { peer = other; },
    };
}

describe("postMessageTransport", () => {
    it("integrates with createHermesClient + HermesHandler over a fake port pair", async () => {
        const clientPort = makeFakePort();
        const serverPort = makeFakePort();
        clientPort.connect(serverPort);
        serverPort.connect(clientPort);

        // Server: dispatch incoming via HermesHandler, post response back.
        const hermes = new HermesHandler({ ping: () => "pong" });
        const serverTransport = postMessageTransport(serverPort);
        serverTransport.subscribe(async (msg) => {
            const res = await hermes.dispatch(msg);
            serverTransport.send(res);
        });

        const dispatch = createHermesClient(postMessageTransport(clientPort));
        const res = await dispatch({ type: "ping" });

        expect(res).toEqual({ ok: true, result: "pong" });
    });

    it("attaches outbound discriminator and filters by inbound discriminator", async () => {
        const a = makeFakePort();
        const b = makeFakePort();
        a.connect(b);
        b.connect(a);

        const hermes = new HermesHandler({ echo: (msg) => msg.payload });
        const serverT = postMessageTransport(b, {
            outbound: { source: "server" },
            inbound: { source: "client" },
        });
        serverT.subscribe(async (msg) => {
            // The transport already stripped 'source' from the canonical envelope.
            expect("source" in msg).toBe(false);
            const res = await hermes.dispatch(msg);
            serverT.send(res);
        });

        const dispatch = createHermesClient(
            postMessageTransport(a, {
                outbound: { source: "client" },
                inbound: { source: "server" },
            })
        );
        const res = await dispatch({ type: "echo", payload: { x: 1 } });
        expect(res).toEqual({ ok: true, result: { x: 1 }, requestId: res.requestId });
    });

    it("drops inbound messages that fail the discriminator filter", async () => {
        const port = makeFakePort();
        const peer = makeFakePort();
        port.connect(peer);
        peer.connect(port);

        const received = [];
        const transport = postMessageTransport(port, { inbound: { source: "expected" } });
        transport.subscribe((msg) => received.push(msg));

        // Send via peer.postMessage which fans out to port.listeners
        peer.postMessage({ source: "expected", type: "good" });
        peer.postMessage({ source: "other",    type: "bad" });
        peer.postMessage({ source: "expected", type: "also good" });

        // Wait one microtask
        await Promise.resolve();
        expect(received.map(m => m.type)).toEqual(["good", "also good"]);
    });

    it("rejects targets that lack postMessage / addEventListener", () => {
        expect(() => postMessageTransport(null)).toThrow(/postMessage/);
        expect(() => postMessageTransport({ postMessage: () => {} })).toThrow(/addEventListener/);
    });
});
