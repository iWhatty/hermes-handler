import { describe, it, expect, vi } from "vitest";
import { MessageChannel } from "node:worker_threads";
import { postMessageTransport, servePostMessage } from "../../src/transports/postmessage.js";
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
    it.each([null, undefined, false, 42, "noise"])("drops non-object wire data: %j", (data) => {
        const port = makeFakePort();
        const peer = makeFakePort();
        peer.connect(port);
        const received = vi.fn();
        const unsubscribe = postMessageTransport(port).subscribe(received);

        try {
            peer.postMessage(data);
            expect(received).not.toHaveBeenCalled();
            const valid = { ok: true, requestId: "request-1", result: "pong" };
            peer.postMessage(valid);
            expect(received).toHaveBeenCalledTimes(1);
            expect(received).toHaveBeenCalledWith(valid);
        } finally {
            unsubscribe();
        }
    });

    it("forwards object messages without validating type or requestId", () => {
        const port = makeFakePort();
        const peer = makeFakePort();
        peer.connect(port);
        const received = vi.fn();
        const unsubscribe = postMessageTransport(port).subscribe(received);
        const messages = [{}, { type: "ping", requestId: 42 }, { type: "unknown" }];

        try {
            for (const message of messages) peer.postMessage(message);
            expect(received.mock.calls).toEqual(messages.map(message => [message]));
        } finally {
            unsubscribe();
        }
    });

    it.each([42, null, false, {}, []].map(value => [value]))("does not correlate a response with a non-string requestId: %j", async (requestId) => {
        const port = makeFakePort();
        const peer = makeFakePort();
        peer.connect(port);
        const dispatch = createHermesClient({ ...postMessageTransport(port), idGen: () => "42" });

        try {
            const pending = dispatch({ type: "ping" });
            peer.postMessage({ ok: true, requestId, result: "wrong" });
            peer.postMessage({ ok: true, requestId: "42", result: "right" });
            await expect(pending).resolves.toEqual({ ok: true, result: "right" });
        } finally {
            dispatch.close();
        }
    });

    it("activates real MessagePort endpoints for a full client/server round-trip", async () => {
        const { port1: serverPort, port2: clientPort } = new MessageChannel();
        const originalServerStart = serverPort.start.bind(serverPort);
        const originalClientStart = clientPort.start.bind(clientPort);
        let serverStartCalls = 0;
        let clientStartCalls = 0;
        serverPort.start = () => {
            serverStartCalls += 1;
            return originalServerStart();
        };
        clientPort.start = () => {
            clientStartCalls += 1;
            return originalClientStart();
        };

        const hermes = new HermesHandler({ ping: () => "pong" }, { logger: null });
        const stop = servePostMessage(hermes, serverPort);
        const dispatch = createHermesClient(postMessageTransport(clientPort));

        try {
            await expect(dispatch({ type: "ping" })).resolves.toEqual({ ok: true, result: "pong" });
            expect(serverStartCalls).toBe(1);
            expect(clientStartCalls).toBe(1);
        } finally {
            stop();
            serverPort.close();
            clientPort.close();
        }
    });

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

describe("servePostMessage", () => {
    it.each([null, undefined, false, 42, "noise", {}, { requestId: "request-1" }, { type: 42, requestId: "request-1" }])(
        "ignores wire data without a string type: %j", (data) => {
            const port = makeFakePort();
            const peer = makeFakePort();
            peer.connect(port);
            const hermes = new HermesHandler({ ping: () => "pong" });
            const dispatch = vi.spyOn(hermes, "dispatch");
            const reply = vi.spyOn(port, "postMessage");
            const stop = servePostMessage(hermes, port);

            try {
                peer.postMessage(data);
                expect(dispatch).not.toHaveBeenCalled();
                expect(reply).not.toHaveBeenCalled();
            } finally {
                stop();
            }
        }
    );

    it.each([42, null, false, {}, []].map(value => [value]))("preserves a supplied non-string requestId in the reply: %j", async (requestId) => {
        const port = makeFakePort();
        const peer = makeFakePort();
        peer.connect(port);
        const handler = vi.fn(() => "pong");
        const reply = vi.spyOn(port, "postMessage");
        const stop = servePostMessage(new HermesHandler({ ping: handler }), port);

        try {
            peer.postMessage({ type: "ping", requestId });
            await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({
                ok: true, result: "pong", requestId
            }));
            expect(reply).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            stop();
        }
    });

    it.each([false, true])("replies to unknown types with custom onUnknown=%s", async (custom) => {
        const port = makeFakePort();
        const peer = makeFakePort();
        peer.connect(port);
        const onUnknown = vi.fn((msg) => ({ ok: true, result: `fallback:${msg.type}` }));
        const hermes = new HermesHandler({}, custom ? { onUnknown } : {});
        const reply = vi.spyOn(port, "postMessage");
        const stop = servePostMessage(hermes, port);
        const message = { type: "unknown", requestId: "request-1" };

        try {
            peer.postMessage(message);
            await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(custom
                ? { ok: true, result: "fallback:unknown", requestId: "request-1" }
                : { ok: false, error: "Unknown msg.type: unknown", requestId: "request-1" }));
            expect(reply).toHaveBeenCalledTimes(1);
            if (custom) {
                expect(onUnknown).toHaveBeenCalledTimes(1);
                expect(onUnknown).toHaveBeenCalledWith(message, expect.objectContaining({
                    requestId: "request-1",
                    sender: { endpoint: port, event: { data: message } }
                }));
            }
        } finally {
            stop();
        }
    });
});
