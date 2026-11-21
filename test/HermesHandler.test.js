import { describe, it, expect } from "vitest";
import { HermesHandler } from "../src/HermesHandler.js";
import { getTransferList } from "../src/internal/transfer.js";

async function withAbortController(Controller, run) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "AbortController");
    Object.defineProperty(globalThis, "AbortController", {
        configurable: true,
        writable: true,
        value: Controller,
    });
    try {
        return await run();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "AbortController", descriptor);
        else delete globalThis.AbortController;
    }
}

describe("HermesHandler", () => {
    it("registerMany adds functions and config entries and overwrites existing handlers", async () => {
        const hermes = new HermesHandler({ ping: () => "old", keep: () => "kept" });

        hermes.registerMany({
            ping: () => "new",
            echo: { handler: (msg) => msg.payload, timeoutMs: 0 }
        });

        await expect(hermes.dispatch({ type: "ping" })).resolves.toEqual({ ok: true, result: "new" });
        await expect(hermes.dispatch({ type: "echo", payload: 42 })).resolves.toEqual({ ok: true, result: 42 });
        await expect(hermes.dispatch({ type: "keep" })).resolves.toEqual({ ok: true, result: "kept" });
    });

    it.each([undefined, null, {}])("registerMany accepts an empty map: %j", (map) => {
        const hermes = new HermesHandler({ ping: () => "pong" });

        expect(() => hermes.registerMany(map)).not.toThrow();
        expect(hermes.types()).toEqual(["ping"]);
    });

    it("registerMany ignores inherited entries", () => {
        const hermes = new HermesHandler();
        const map = Object.create({ inherited: () => "ignored" });
        map.own = () => "registered";

        hermes.registerMany(map);

        expect(hermes.types()).toEqual(["own"]);
        expect(hermes.has("inherited")).toBe(false);
    });

    it.each([
        [42, /must be a function or/],
        [{ timeoutMs: 100 }, /must be a function or/],
        [{ handler: () => "bad", timeoutMs: -1 }, /timeoutMs must be a non-negative/]
    ])("registerMany validates entries without replacing a valid handler: %j", async (entry, error) => {
        const hermes = new HermesHandler({ ping: () => "pong" });

        expect(() => hermes.registerMany({ ping: entry })).toThrow(error);
        await expect(hermes.dispatch({ type: "ping" })).resolves.toEqual({ ok: true, result: "pong" });
    });

    it("unregister removes routing and tolerates repeated or missing removals", async () => {
        const hermes = new HermesHandler({ ping: () => "pong", keep: () => "kept" });

        hermes.unregister("ping");
        hermes.unregister("ping");
        hermes.unregister("missing");

        expect(hermes.has("ping")).toBe(false);
        expect(hermes.types()).toEqual(["keep"]);
        await expect(hermes.dispatch({ type: "ping" })).resolves.toEqual({
            ok: false, error: "Unknown msg.type: ping"
        });
        await expect(hermes.dispatch({ type: "keep" })).resolves.toEqual({ ok: true, result: "kept" });
    });

    it("types returns an independent snapshot in registration order", () => {
        const hermes = new HermesHandler();
        expect(hermes.types()).toEqual([]);
        hermes.registerMany({ first: () => 1, second: () => 2 });
        const snapshot = hermes.types();
        hermes.register("first", () => "replacement");
        expect(hermes.types()).toEqual(["first", "second"]);
        hermes.unregister("first");
        hermes.register("first", () => 1);

        expect(snapshot).toEqual(["first", "second"]);
        snapshot.push("external");
        expect(hermes.types()).toEqual(["second", "first"]);
        expect(hermes.has("external")).toBe(false);
    });

    // ------------------------------------------------------------
    // Basic Dispatch Behavior
    // ------------------------------------------------------------

    it("dispatches to a registered handler and returns ok envelope", async () => {
        const hermes = new HermesHandler({
            ping: () => "pong"
        });

        const res = await hermes.dispatch({ type: "ping" });

        expect(res.ok).toBe(true);
        expect(res.result).toBe("pong");
    });

    it("normalizes primitive return values into ok envelope", async () => {
        const hermes = new HermesHandler({
            number: () => 42
        });

        const res = await hermes.dispatch({ type: "number" });

        expect(res).toEqual({ ok: true, result: 42 });
    });

    it("normalizes non-envelope objects as the success result", async () => {
        const sourceCandidates = ["content.js", "background.js"];
        const hermes = new HermesHandler({
            sources: () => ({ sourceCandidates })
        });

        const res = await hermes.dispatch({ type: "sources" });

        expect(res).toEqual({ ok: true, result: { sourceCandidates } });
    });

    it("keeps explicit ok:true result first and moves success extras to info", async () => {
        const sourceCandidates = ["content.js"];
        const diagnostics = { inspected: 3 };
        const warnings = ["fallback-used"];
        const hermes = new HermesHandler({
            sources: () => ({
                ok: true,
                result: { sourceCandidates },
                diagnostics,
                warnings
            })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "sources" });

        expect(res).toEqual({
            ok: true,
            result: { sourceCandidates },
            info: { diagnostics, warnings }
        });
    });

    it("normalizes ok:true shorthand fields as the success result", async () => {
        const sourceCandidates = ["content.js", "background.js"];
        const hermes = new HermesHandler({
            sources: () => ({ ok: true, sourceCandidates })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "sources" });

        expect(res).toEqual({ ok: true, result: { sourceCandidates } });
    });

    it("preserves ok:true shorthand info while extras become result", async () => {
        const sourceCandidates = ["content.js"];
        const info = { timingMs: 12 };
        const hermes = new HermesHandler({
            sources: () => ({ ok: true, sourceCandidates, info })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "sources" });

        expect(res).toEqual({
            ok: true,
            result: { sourceCandidates },
            info
        });
    });

    it("treats error on ok:true shorthand as diagnostics instead of result payload", async () => {
        const hermes = new HermesHandler({
            odd: () => ({ ok: true, error: "not actually failed" })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "odd" });

        expect(res).toEqual({
            ok: true,
            info: { error: "not actually failed" }
        });
    });

    it("keeps ok:false handler info canonical when there are no extras", async () => {
        const hermes = new HermesHandler({
            fail: () => ({
                ok: false,
                error: "nope",
                info: { timingMs: 12 }
            })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "fail" });

        expect(res).toEqual({
            ok: false,
            error: "nope",
            info: { timingMs: 12 }
        });
    });

    it("keeps ok:false strict and preserves handler info under handlerInfo when extras exist", async () => {
        const hermes = new HermesHandler({
            fail: () => ({
                ok: false,
                error: "nope",
                info: { timingMs: 12 },
                diagnostics: { inspected: 3 }
            })
        }, { logger: null });

        const res = await hermes.dispatch({ type: "fail" });

        expect(res).toEqual({
            ok: false,
            error: "nope",
            info: {
                handlerInfo: { timingMs: 12 },
                diagnostics: { inspected: 3 }
            }
        });
    });

    it("echoes requestId on ok:true shorthand unless the handler provides one", async () => {
        const hermes = new HermesHandler({
            echo: () => ({ ok: true, sourceCandidates: ["content.js"] }),
            override: () => ({ ok: true, sourceCandidates: ["content.js"], requestId: "handler-set" })
        }, { logger: null });

        await expect(hermes.dispatch({ type: "echo", requestId: "request-set" })).resolves.toEqual({
            ok: true,
            result: { sourceCandidates: ["content.js"] },
            requestId: "request-set"
        });
        await expect(hermes.dispatch({ type: "override", requestId: "request-set" })).resolves.toEqual({
            ok: true,
            result: { sourceCandidates: ["content.js"] },
            requestId: "handler-set"
        });
    });

    it("returns error envelope for unknown type", async () => {
        const hermes = new HermesHandler({});
        const res = await hermes.dispatch({ type: "nope" });

        expect(res.ok).toBe(false);
        expect(typeof res.error).toBe("string");
    });

    it("keeps dispatch deterministic when ignoreUnknown is enabled", async () => {
        const hermes = new HermesHandler({}, { ignoreUnknown: true });
        const res = await hermes.dispatch({ type: "nope" });

        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Unknown msg\.type/);
    });

    it("treats an inaccessible requestId as absent without rejecting dispatch", async () => {
        const msg = { type: "ping" };
        Object.defineProperty(msg, "requestId", { get: () => { throw new Error("requestId failed"); } });
        const hermes = new HermesHandler({ ping: () => "pong" });

        await expect(hermes.dispatch(msg))
            .resolves.toEqual({ ok: true, result: "pong" });
    });

    it("treats an inaccessible type as missing while preserving correlation", async () => {
        const msg = { requestId: "hostile-type-id" };
        Object.defineProperty(msg, "type", { get: () => { throw new Error("type failed"); } });
        const hermes = new HermesHandler({ ping: () => "pong" });

        await expect(hermes.dispatch(msg)).resolves.toEqual({
            ok: false,
            error: "Invalid message: msg missing string 'type'",
            requestId: "hostile-type-id",
        });
    });

    it("contains revoked message proxies at the direct dispatch boundary", async () => {
        const revocable = Proxy.revocable({ type: "ping" }, {});
        revocable.revoke();
        const hermes = new HermesHandler({ ping: () => "pong" });

        await expect(hermes.dispatch(revocable.proxy)).resolves.toEqual({
            ok: false,
            error: "Invalid message: msg missing string 'type'",
        });
    });

    it.each([
        ["a throwing sender.tab getter", () => {
            const sender = {};
            Object.defineProperty(sender, "tab", { get: () => { throw new Error("tab failed"); } });
            return sender;
        }],
        ["a throwing sender.tab.id getter", () => {
            const tab = {};
            Object.defineProperty(tab, "id", { get: () => { throw new Error("id failed"); } });
            return { tab };
        }],
        ["a revoked sender proxy", () => {
            const revocable = Proxy.revocable({ tab: { id: 42 } }, {});
            revocable.revoke();
            return revocable.proxy;
        }],
    ])("contains %s while preserving the raw sender", async (_name, createSender) => {
        const sender = createSender();
        let receivedSender;
        const hermes = new HermesHandler({
            ping: (_payload, ctx) => {
                receivedSender = ctx.sender;
                expect(ctx.tabId).toBeUndefined();
                return "pong";
            },
        });

        await expect(hermes.dispatch({ type: "ping" }, sender))
            .resolves.toEqual({ ok: true, result: "pong" });
        expect(receivedSender).toBe(sender);
    });

    it("preserves ordinary derived sender tab IDs", async () => {
        const sender = { tab: { id: 42 } };
        const hermes = new HermesHandler({ ping: (_payload, ctx) => ctx.tabId });

        await expect(hermes.dispatch({ type: "ping" }, sender))
            .resolves.toEqual({ ok: true, result: 42 });
    });

    it("preserves tab ID derivation for legacy direct _dispatch callers", async () => {
        const sender = { tab: { id: 43 } };
        const hermes = new HermesHandler({ ping: (_payload, ctx) => ctx.tabId });

        await expect(hermes._dispatch({ type: "ping" }, sender))
            .resolves.toEqual({ ok: true, result: 43 });
    });

    // ------------------------------------------------------------
    // Timeout Handling
    // ------------------------------------------------------------

    it("returns error when handler exceeds timeout", async () => {
        const hermes = new HermesHandler(
            {
                slow: async () => {
                    await new Promise((r) => setTimeout(r, 50));
                    return "done";
                }
            },
            { timeoutMs: 10, logger: null }
        );

        const res = await hermes.dispatch({ type: "slow" });

        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/timed out/i);
    });

    // ------------------------------------------------------------
    // ctx.send Behavior
    // ------------------------------------------------------------

    it("uses ctx.send when handler calls it", async () => {
        const hermes = new HermesHandler({
            custom: (msg, ctx) => {
                ctx.send({ ok: true, result: "via-send" });
            }
        });

        const res = await hermes.dispatch({ type: "custom" });

        expect(res.ok).toBe(true);
        expect(res.result).toBe("via-send");
    });

    it("ignores multiple ctx.send calls and keeps first response", async () => {
        const hermes = new HermesHandler(
            {
                multi: (msg, ctx) => {
                    ctx.send("first");
                    ctx.send("second");
                }
            },
            { logger: null }
        );

        const res = await hermes.dispatch({ type: "multi" });

        expect(res.result).toBe("first");
    });

    // ------------------------------------------------------------
    // Cooperative Cancellation Signal
    // ------------------------------------------------------------

    it("provides an AbortSignal in context", async () => {
        const hermes = new HermesHandler({
            checkSignal: (msg, ctx) => {
                expect(ctx.signal).toBeDefined();
                return "ok";
            }
        });

        const res = await hermes.dispatch({ type: "checkSignal" });

        expect(res.ok).toBe(true);
    });

    // ------------------------------------------------------------
    // Runtime Listener Ownership
    // ------------------------------------------------------------

    it("returns false from listener for unknown types when ignoreUnknown is enabled", () => {
        const hermes = new HermesHandler(
            {
                ping: () => "pong"
            },
            { ignoreUnknown: true }
        );
        const listener = hermes.getListener();
        const sendResponse = () => {
            throw new Error("sendResponse should not be called");
        };

        expect(listener({ type: "nope" })).toBe(false);
        expect(listener({ type: "nope" }, {}, sendResponse)).toBe(false);
        expect(listener({ payload: "missing-type" }, {}, sendResponse)).toBe(false);
    });

    it("does not derive sender metadata before listener ownership is accepted", () => {
        let tabReads = 0;
        const sender = {};
        Object.defineProperty(sender, "tab", {
            get: () => {
                tabReads += 1;
                throw new Error("tab should not be read");
            },
        });
        const hermes = new HermesHandler(
            { ping: () => "pong" },
            {
                shouldHandle: (_msg, receivedSender) => {
                    expect(receivedSender).toBe(sender);
                    return false;
                },
            }
        );

        expect(hermes.getListener()({ type: "ping" }, sender)).toBe(false);
        expect(tabReads).toBe(0);
    });

    it("contains hostile sender metadata in promise-style listeners", async () => {
        const sender = {};
        Object.defineProperty(sender, "tab", { get: () => { throw new Error("tab failed"); } });
        const hermes = new HermesHandler({
            ping: (_payload, ctx) => ({ sameSender: ctx.sender === sender, tabId: ctx.tabId }),
        });

        await expect(hermes.getListener()({ type: "ping" }, sender)).resolves.toEqual({
            ok: true,
            result: { sameSender: true, tabId: undefined },
        });
    });

    it("declines listener ownership when the type getter throws", () => {
        const hermes = new HermesHandler({ ping: () => "pong" }, { ignoreUnknown: true });
        const listener = hermes.getListener();
        const msg = {};
        Object.defineProperty(msg, "type", { get: () => { throw new Error("type failed"); } });

        expect(() => listener(msg)).not.toThrow();
        expect(listener(msg)).toBe(false);
    });

    it("uses one validated type snapshot across listener ownership and dispatch", async () => {
        let typeReads = 0;
        const msg = {};
        Object.defineProperty(msg, "type", {
            get: () => {
                typeReads += 1;
                if (typeReads > 1) throw new Error("type read twice");
                return "ping";
            },
        });
        const hermes = new HermesHandler({ ping: () => "pong" }, { ignoreUnknown: true });

        await expect(hermes.getListener()(msg)).resolves.toEqual({ ok: true, result: "pong" });
        expect(typeReads).toBe(1);
    });

    it("claims known types when ignoreUnknown is enabled", async () => {
        const hermes = new HermesHandler(
            {
                ping: () => "pong"
            },
            { ignoreUnknown: true }
        );
        const listener = hermes.getListener();

        await expect(listener({ type: "ping" })).resolves.toEqual({ ok: true, result: "pong" });
    });

    it("uses shouldHandle as the runtime listener ownership predicate", async () => {
        const hermes = new HermesHandler(
            {
                ping: () => "pong"
            },
            {
                shouldHandle: (msg) => msg?.scope === "popup" || hermes.has(msg?.type)
            }
        );
        const listener = hermes.getListener();

        expect(listener({ type: "unknown", scope: "background" })).toBe(false);

        await expect(listener({ type: "unknown", scope: "popup" })).resolves.toMatchObject({
            ok: false,
            error: "Unknown msg.type: unknown"
        });
        await expect(listener({ type: "ping" })).resolves.toEqual({ ok: true, result: "pong" });
    });
    it("declines ownership when shouldHandle throws without affecting direct dispatch", async () => {
        let handlerCalls = 0;
        let logCalls = 0;
        const hermes = new HermesHandler(
            {
                ping: () => {
                    handlerCalls += 1;
                    return "pong";
                },
            },
            {
                shouldHandle: () => { throw new Error("ownership failed"); },
                logger: {
                    error: () => {
                        logCalls += 1;
                        throw new Error("logger failed");
                    },
                },
            }
        );
        const listener = hermes.getListener();
        let responseCalls = 0;

        expect(listener(
            { type: "ping" },
            {},
            () => { responseCalls += 1; }
        )).toBe(false);
        expect(handlerCalls).toBe(0);
        expect(responseCalls).toBe(0);
        expect(logCalls).toBe(1);

        await expect(hermes.dispatch({ type: "ping" }))
            .resolves.toEqual({ ok: true, result: "pong" });
        expect(handlerCalls).toBe(1);
    });

    it("delivers callback-style responses exactly once", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" }, { logger: null });
        const listener = hermes.getListener();
        let responseCalls = 0;

        const response = await new Promise((resolve) => {
            expect(listener({ type: "ping" }, {}, (payload) => {
                responseCalls += 1;
                resolve(payload);
            })).toBe(true);
        });

        expect(response).toEqual({ ok: true, result: "pong" });
        expect(responseCalls).toBe(1);
    });

    it("consumes a throwing sendResponse callback without retrying it", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" }, { logger: null });
        const listener = hermes.getListener();
        let responseCalls = 0;

        expect(listener({ type: "ping" }, {}, () => {
            responseCalls += 1;
            throw new Error("callback failed");
        })).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(responseCalls).toBe(1);
    });

    // ------------------------------------------------------------
    // requestId echo (manual-transport correlation)
    // ------------------------------------------------------------

    it("echoes requestId from request into response (success)", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" });
        const res = await hermes.dispatch({ type: "ping", requestId: "abc-123" });
        expect(res).toEqual({ ok: true, result: "pong", requestId: "abc-123" });
    });

    it("echoes requestId into error responses (unknown type)", async () => {
        const hermes = new HermesHandler({});
        const res = await hermes.dispatch({ type: "nope", requestId: "rid-1" });
        expect(res.ok).toBe(false);
        expect(res.requestId).toBe("rid-1");
    });

    it("echoes requestId for invalid-message early returns", async () => {
        const hermes = new HermesHandler({});
        const res1 = await hermes.dispatch({ requestId: "rid-2" });
        expect(res1).toMatchObject({ ok: false, requestId: "rid-2" });
        const res2 = await hermes.dispatch({ type: "", requestId: "rid-3" });
        expect(res2).toMatchObject({ ok: false, requestId: "rid-3" });
    });

    it("does not stamp requestId when the request has none", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" });
        const res = await hermes.dispatch({ type: "ping" });
        expect(res).toEqual({ ok: true, result: "pong" });
        expect("requestId" in res).toBe(false);
    });

    it("preserves an explicit requestId set by the handler", async () => {
        const hermes = new HermesHandler({
            relay: () => ({ ok: true, result: "x", requestId: "handler-set" })
        });
        const res = await hermes.dispatch({ type: "relay", requestId: "request-set" });
        expect(res.requestId).toBe("handler-set");
    });

    // ------------------------------------------------------------
    // Per-handler config blocks
    // ------------------------------------------------------------

    it("accepts handler map entries as { handler, timeoutMs } config objects", async () => {
        const hermes = new HermesHandler({
            ping: () => "pong",
            slow: {
                timeoutMs: 50,
                handler: () => new Promise((r) => setTimeout(() => r("late"), 200))
            }
        }, { logger: null });

        await expect(hermes.dispatch({ type: "ping" })).resolves.toEqual({ ok: true, result: "pong" });
        const slowRes = await hermes.dispatch({ type: "slow" });
        expect(slowRes).toMatchObject({ ok: false });
        expect(slowRes.error).toMatch(/timed out \(50 ms\)/);
    });

    it("per-handler timeoutMs overrides the class-level timeoutMs", async () => {
        // Class-level says 500ms; per-handler says 50ms — per-handler wins.
        const hermes = new HermesHandler({
            fast: {
                timeoutMs: 50,
                handler: () => new Promise((r) => setTimeout(() => r("done"), 200))
            }
        }, { timeoutMs: 500, logger: null });

        const res = await hermes.dispatch({ type: "fast" });
        expect(res).toMatchObject({ ok: false });
        expect(res.error).toMatch(/timed out \(50 ms\)/);
    });

    it("handlers without per-config timeoutMs fall back to class default", async () => {
        const hermes = new HermesHandler({
            slow: () => new Promise((r) => setTimeout(() => r("done"), 200))
        }, { timeoutMs: 50, logger: null });

        const res = await hermes.dispatch({ type: "slow" });
        expect(res).toMatchObject({ ok: false });
        expect(res.error).toMatch(/timed out \(50 ms\)/);
    });

    it("timeoutMs: 0 on a per-handler config disables the timeout", async () => {
        // Class-level would fire at 50ms; per-handler 0 disables.
        const hermes = new HermesHandler({
            patient: {
                timeoutMs: 0,
                handler: () => new Promise((r) => setTimeout(() => r("done"), 100))
            }
        }, { timeoutMs: 50 });

        const res = await hermes.dispatch({ type: "patient" });
        expect(res).toEqual({ ok: true, result: "done" });
    });

    it("register(type, config) accepts both bare functions and config objects", () => {
        const hermes = new HermesHandler({});

        hermes.register("ping", () => "pong");
        hermes.register("slow", { timeoutMs: 30000, handler: () => "ok" });

        expect(hermes.has("ping")).toBe(true);
        expect(hermes.has("slow")).toBe(true);
    });

    it("rejects malformed handler entries with a clear error", () => {
        expect(() => new HermesHandler({ bad: 42 })).toThrow(/must be a function or/);
        expect(() => new HermesHandler({ noHandler: { timeoutMs: 100 } })).toThrow(/must be a function or/);
        expect(() => new HermesHandler({ negative: { timeoutMs: -1, handler: () => {} } })).toThrow(/timeoutMs must be a non-negative/);
    });

    it("rejects invalid route names at construction and registration", () => {
        const handler = () => "ok";

        expect(() => new HermesHandler({ "": handler })).toThrow(/route type must be a non-empty string/);

        const hermes = new HermesHandler({});
        expect(() => hermes.register("", handler)).toThrow(/route type must be a non-empty string/);
        expect(() => hermes.register(42, handler)).toThrow(/route type must be a non-empty string/);
        expect(() => hermes.registerMany({ "": handler })).toThrow(/route type must be a non-empty string/);
    });

    it("validates router factory options and accepts numeric timeout settings", () => {
        expect(() => new HermesHandler(null)).toThrow(/initialHandlers must be an object map/);
        expect(() => new HermesHandler([])).toThrow(/initialHandlers must be an object map/);
        expect(() => new HermesHandler({}, null)).toThrow(/options must be an object/);

        expect(() => new HermesHandler({}, { timeoutMs: "10" })).toThrow(/timeoutMs must be a number/);
        for (const timeoutMs of [0, -1, NaN, Infinity, -Infinity]) {
            expect(() => new HermesHandler({}, { timeoutMs, logger: null })).not.toThrow();
        }

        expect(() => new HermesHandler({}, { onUnknown: null })).toThrow(/onUnknown must be a function/);
        expect(() => new HermesHandler({}, { onError: null })).toThrow(/onError must be a function/);
        expect(() => new HermesHandler({}, { ignoreUnknown: "yes" })).toThrow(/ignoreUnknown must be a boolean/);
        expect(() => new HermesHandler({}, { shouldHandle: true })).toThrow(/shouldHandle must be a function/);
    });

    // ------------------------------------------------------------
    // Middleware pipeline (.use)
    // ------------------------------------------------------------

    it(".use() registers a middleware that wraps the handler", async () => {
        const seen = [];
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (msg, _ctx, next) => {
            seen.push(`before:${msg.type}`);
            const res = await next();
            seen.push(`after:${msg.type}:${res.ok}`);
            return res;
        });

        const res = await hermes.dispatch({ type: "ping" });
        expect(res).toEqual({ ok: true, result: "pong" });
        expect(seen).toEqual(["before:ping", "after:ping:true"]);
    });

    it("middlewares run in registration order (outer wraps inner)", async () => {
        const order = [];
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (_m, _c, next) => { order.push("A in"); const r = await next(); order.push("A out"); return r; });
        hermes.use(async (_m, _c, next) => { order.push("B in"); const r = await next(); order.push("B out"); return r; });

        await hermes.dispatch({ type: "ping" });
        expect(order).toEqual(["A in", "B in", "B out", "A out"]);
    });

    it("middleware can short-circuit by returning without calling next()", async () => {
        let innerCalled = false;
        const hermes = new HermesHandler({
            ping: () => { innerCalled = true; return "pong"; }
        });
        hermes.use(async () => ({ ok: false, error: "blocked by middleware" }));

        const res = await hermes.dispatch({ type: "ping" });
        expect(res).toMatchObject({ ok: false, error: "blocked by middleware" });
        expect(innerCalled).toBe(false);
    });

    it("middleware can transform the response after next()", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (_m, _c, next) => {
            const res = await next();
            if (res.ok) return { ok: true, result: `wrapped:${res.result}` };
            return res;
        });

        const res = await hermes.dispatch({ type: "ping" });
        expect(res).toEqual({ ok: true, result: "wrapped:pong" });
    });

    it("middleware throws become onError envelopes", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" }, { logger: null });
        hermes.use(() => { throw new Error("middleware exploded"); });

        const res = await hermes.dispatch({ type: "ping" });
        expect(res).toMatchObject({ ok: false });
        expect(res.error).toMatch(/middleware exploded/);
    });

    it("middleware sees ctx.requestId echoed from the request", async () => {
        let seenRequestId = null;
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (_m, ctx, next) => {
            seenRequestId = ctx.requestId;
            return next();
        });

        await hermes.dispatch({ type: "ping", requestId: "r-42" });
        expect(seenRequestId).toBe("r-42");
    });

    it("middleware can read ctx.signal for cooperative cancellation in long ops", async () => {
        let saw = false;
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (_m, ctx, next) => {
            saw = ctx.signal instanceof AbortSignal;
            return next();
        });
        await hermes.dispatch({ type: "ping" });
        expect(saw).toBe(true);
    });

    it("keeps dispatch deterministic when AbortController construction throws", async () => {
        class BrokenAbortController {
            constructor() { throw new Error("controller failed"); }
        }

        await withAbortController(BrokenAbortController, async () => {
            const hermes = new HermesHandler({
                ping: (_msg, ctx) => ({ signal: ctx.signal }),
            });
            await expect(hermes.dispatch({ type: "ping", requestId: "constructor-id" }))
                .resolves.toEqual({ ok: true, result: { signal: undefined }, requestId: "constructor-id" });
        });
    });

    it("keeps dispatch deterministic when AbortController.signal throws", async () => {
        class BrokenAbortController {
            get signal() { throw new Error("signal failed"); }
            abort() {}
        }

        await withAbortController(BrokenAbortController, async () => {
            const hermes = new HermesHandler({
                ping: (_msg, ctx) => ({ signal: ctx.signal }),
            });
            await expect(hermes.dispatch({ type: "ping", requestId: "signal-id" }))
                .resolves.toEqual({ ok: true, result: { signal: undefined }, requestId: "signal-id" });
        });
    });

    it("preserves a completed envelope when AbortController.abort throws", async () => {
        class BrokenAbortController {
            signal = {};
            abort() { throw new Error("abort failed"); }
        }

        await withAbortController(BrokenAbortController, async () => {
            const hermes = new HermesHandler({ ping: () => "pong" });
            const response = await hermes.dispatch({ type: "ping", requestId: "abort-id" });
            expect(response).toEqual({ ok: true, result: "pong", requestId: "abort-id" });
            expect(Object.isFrozen(response)).toBe(true);
        });
    });

    it("preserves healthy AbortController signal and cleanup behavior", async () => {
        const signal = {};
        let abortCalls = 0;
        class HealthyAbortController {
            constructor() { this.signal = signal; }
            abort() { abortCalls += 1; }
        }

        await withAbortController(HealthyAbortController, async () => {
            const hermes = new HermesHandler({
                ping: (_msg, ctx) => ctx.signal === signal,
            });
            await expect(hermes.dispatch({ type: "ping" }))
                .resolves.toEqual({ ok: true, result: true });
            expect(abortCalls).toBe(1);
        });
    });

    it("middleware can guard unknown types before they reach onUnknown", async () => {
        const hermes = new HermesHandler({ ping: () => "pong" });
        hermes.use(async (msg, _c, next) => {
            if (msg.type.startsWith("admin:")) {
                return { ok: false, error: "admin: forbidden in this context" };
            }
            return next();
        });

        const r1 = await hermes.dispatch({ type: "admin:wipe" });
        expect(r1).toMatchObject({ ok: false, error: "admin: forbidden in this context" });

        const r2 = await hermes.dispatch({ type: "ping" });
        expect(r2).toEqual({ ok: true, result: "pong" });
    });

    it(".use() returns `this` for chaining", () => {
        const hermes = new HermesHandler({ ping: () => "pong" });
        const ret = hermes.use(async (_m, _c, next) => next()).use(async (_m, _c, next) => next());
        expect(ret).toBe(hermes);
    });

    it(".use() rejects non-function args", () => {
        const hermes = new HermesHandler({});
        expect(() => hermes.use(null)).toThrow(/must be a function/);
        expect(() => hermes.use(42)).toThrow(/must be a function/);
    });
    it("falls back to a canonical correlated error when onError throws", async () => {
        const hermes = new HermesHandler(
            { fail: () => { throw new Error("handler failed"); } },
            {
                logger: null,
                onError: () => { throw new Error("error hook failed"); },
            }
        );

        const response = await hermes.dispatch({ type: "fail", requestId: "handler-request" });

        expect(response).toEqual({
            ok: false,
            error: "handler failed",
            requestId: "handler-request",
        });
        expect(Object.isFrozen(response)).toBe(true);
    });

    it("handles a throwing onError hook for middleware failures", async () => {
        const hermes = new HermesHandler(
            { ping: () => "pong" },
            {
                logger: null,
                onError: () => { throw new Error("error hook failed"); },
            }
        );
        hermes.use(() => { throw new Error("middleware failed"); });

        await expect(hermes.dispatch({ type: "ping", requestId: "middleware-request" }))
            .resolves.toEqual({
                ok: false,
                error: "middleware failed",
                requestId: "middleware-request",
            });
    });

    it("defends the callback listener error path from a throwing onError hook", async () => {
        const hermes = new HermesHandler(
            {},
            {
                logger: null,
                onError: () => { throw new Error("error hook failed"); },
            }
        );
        hermes._dispatch = () => Promise.reject(new Error("listener failed"));
        const listener = hermes.getListener();

        const responsePromise = new Promise((resolve) => {
            expect(listener(
                { type: "fail", requestId: "listener-request" },
                {},
                resolve
            )).toBe(true);
        });
        const response = await responsePromise;

        expect(response).toEqual({
            ok: false,
            error: "listener failed",
            requestId: "listener-request",
        });
        expect(Object.isFrozen(response)).toBe(true);
    });

    it("contains an inaccessible requestId during callback listener recovery", async () => {
        const hermes = new HermesHandler({}, { logger: null });
        hermes._dispatch = () => Promise.reject(new Error("listener failed"));
        const listener = hermes.getListener();
        const msg = { type: "fail" };
        Object.defineProperty(msg, "requestId", { get: () => { throw new Error("requestId failed"); } });

        const response = await new Promise((resolve) => {
            expect(listener(msg, {}, resolve)).toBe(true);
        });

        expect(response).toEqual({ ok: false, error: "listener failed" });
        expect(Object.isFrozen(response)).toBe(true);
    });

    it("contains hostile sender metadata during callback listener recovery", async () => {
        const sender = {};
        Object.defineProperty(sender, "tab", { get: () => { throw new Error("tab failed"); } });
        const hermes = new HermesHandler({}, { logger: null });
        hermes._dispatch = () => Promise.reject(new Error("listener failed"));
        const listener = hermes.getListener();

        const response = await new Promise((resolve) => {
            expect(listener({ type: "fail", requestId: "sender-request" }, sender, resolve)).toBe(true);
        });

        expect(response).toEqual({
            ok: false,
            error: "listener failed",
            requestId: "sender-request",
        });
        expect(Object.isFrozen(response)).toBe(true);
    });

    it("preserves an explicit requestId returned by onError", async () => {
        const hermes = new HermesHandler(
            { fail: () => { throw new Error("handler failed"); } },
            {
                logger: null,
                onError: () => ({ ok: false, error: "custom", requestId: "hook-request" }),
            }
        );

        await expect(hermes.dispatch({ type: "fail", requestId: "inbound-request" }))
            .resolves.toEqual({
                ok: false,
                error: "custom",
                requestId: "hook-request",
            });
    });

    it("clones a frozen normalized envelope before adding correlation", async () => {
        const buffer = new ArrayBuffer(8);
        const source = new HermesHandler({
            ping: (_msg, ctx) => {
                ctx.transfer(buffer);
                return "pong";
            },
        }, { logger: null });
        const frozen = await source.dispatch({ type: "ping" });
        const relay = new HermesHandler({ relay: () => frozen }, { logger: null });

        const response = await relay.dispatch({ type: "relay", requestId: "relay-request" });

        expect(response).toEqual({
            ok: true,
            result: "pong",
            requestId: "relay-request",
        });
        expect(getTransferList(response)).toEqual([buffer]);
        expect(Object.isFrozen(response)).toBe(true);
        expect(frozen).toEqual({ ok: true, result: "pong" });
        expect("requestId" in frozen).toBe(false);
    });

    it.each([
        [
            "ok:false extras",
            { ok: false, error: "nope", diagnostics: { inspected: 1 } },
            { ok: false, error: "nope", info: { diagnostics: { inspected: 1 } }, requestId: "warn-id" },
        ],
        [
            "ok:true result extras",
            { ok: true, result: "yes", diagnostics: { inspected: 1 } },
            { ok: true, result: "yes", info: { diagnostics: { inspected: 1 } }, requestId: "warn-id" },
        ],
        [
            "ok:true shorthand error",
            { ok: true, value: 1, error: "diagnostic" },
            { ok: true, result: { value: 1 }, info: { error: "diagnostic" }, requestId: "warn-id" },
        ],
    ])("preserves normalized %s responses when logger.warn throws", async (_label, payload, expected) => {
        const hermes = new HermesHandler(
            { route: () => payload },
            { logger: { warn: () => { throw new Error("logger failed"); } } },
        );

        const response = await hermes.dispatch({ type: "route", requestId: "warn-id" });

        expect(response).toEqual(expected);
        expect(Object.isFrozen(response)).toBe(true);
    });

    it("contains a throwing logger.warn getter during normalization", async () => {
        const logger = {};
        Object.defineProperty(logger, "warn", { get: () => { throw new Error("warn getter failed"); } });
        const hermes = new HermesHandler(
            { route: () => ({ ok: true, result: "yes", diagnostics: { inspected: 1 } }) },
            { logger },
        );

        await expect(hermes.dispatch({ type: "route" })).resolves.toEqual({
            ok: true,
            result: "yes",
            info: { diagnostics: { inspected: 1 } },
        });
    });

    it("preserves handler error envelopes when logger.error throws", async () => {
        const hermes = new HermesHandler(
            { fail: () => { throw new Error("handler failed"); } },
            { logger: { error: () => { throw new Error("logger failed"); } } },
        );

        await expect(hermes.dispatch({ type: "fail", requestId: "handler-id" })).resolves.toEqual({
            ok: false,
            error: "handler failed",
            requestId: "handler-id",
        });
    });

    it("preserves middleware error envelopes when logger.error throws", async () => {
        const hermes = new HermesHandler(
            { ping: () => "pong" },
            { logger: { error: () => { throw new Error("logger failed"); } } },
        );
        hermes.use(() => { throw new Error("middleware failed"); });

        await expect(hermes.dispatch({ type: "ping", requestId: "middleware-id" })).resolves.toEqual({
            ok: false,
            error: "middleware failed",
            requestId: "middleware-id",
        });
    });

    it("keeps the first ctx.send response when duplicate-send logging throws", async () => {
        const hermes = new HermesHandler(
            {
                multi: (_msg, ctx) => {
                    ctx.send("first");
                    ctx.send("second");
                },
            },
            { logger: { warn: () => { throw new Error("logger failed"); } } },
        );

        await expect(hermes.dispatch({ type: "multi" })).resolves.toEqual({ ok: true, result: "first" });
    });

    it("keeps healthy logger receiver and warning arguments", async () => {
        const calls = [];
        const logger = {
            warn(...args) {
                expect(this).toBe(logger);
                calls.push(args);
            },
        };
        const hermes = new HermesHandler(
            { route: () => ({ ok: true, result: "yes", diagnostics: { inspected: 1 } }) },
            { logger },
        );

        await hermes.dispatch({ type: "route" });

        expect(calls).toEqual([[
            "[Hermes] ok:true response contained extra fields; preserved in info",
            { extraKeys: ["diagnostics"] },
        ]]);
    });
});
