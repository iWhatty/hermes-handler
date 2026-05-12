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
});
