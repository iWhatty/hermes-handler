import { describe, it, expect } from "vitest";
import { HermesHandler } from "../src/HermesHandler.js";

describe("HermesHandler", () => {
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
        });

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
        }, { timeoutMs: 500 });

        const res = await hermes.dispatch({ type: "fast" });
        expect(res).toMatchObject({ ok: false });
        expect(res.error).toMatch(/timed out \(50 ms\)/);
    });

    it("handlers without per-config timeoutMs fall back to class default", async () => {
        const hermes = new HermesHandler({
            slow: () => new Promise((r) => setTimeout(() => r("done"), 200))
        }, { timeoutMs: 50 });

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
});
