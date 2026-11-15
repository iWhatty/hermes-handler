import { describe, it, expect, vi } from "vitest";
import { HermesHandler } from "../src/HermesHandler.js";
import { defineBoundary, classifySender, createGuard } from "../src/guard.js";

const ORIGIN = "chrome-extension://abcdef/";
const ID = "abcdef";
const POPUP = { url: `${ORIGIN}popup.html`, id: ID };
const OPTIONS_PAGE = { url: `${ORIGIN}options.html`, id: ID };
const CONTENT = { url: "https://example.com/", id: ID, tab: { id: 7 } };
const classify = (/** @type {unknown} */ sender) =>
    classifySender(sender, { origin: ORIGIN, id: ID, pages: { popup: "/popup.html" } });

const silent = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("defineBoundary", () => {
    it.each([
        ["a name map", Object.freeze({ PING: "ping", SAVE: "save" })],
        ["an array", ["ping", "save"]],
    ])("accepts %s and freezes the boundary and its types", (_label, names) => {
        const b = defineBoundary("B", names);

        expect(b.types).toEqual(["ping", "save"]);
        expect(Object.isFrozen(b)).toBe(true);
        expect(Object.isFrozen(b.types)).toBe(true);
        expect(b.label).toBe("B");
    });

    it("does not alias the caller's array", () => {
        const names = ["ping"];
        const b = defineBoundary("B", names);
        names.push("late");

        expect(b.types).toEqual(["ping"]);
        expect(b.has("late")).toBe(false);
    });

    it("throws on duplicate wire values", () => {
        expect(() => defineBoundary("B", { A: "x", B: "x", C: "y" })).toThrow(/B: duplicate wire values: x/);
    });

    it.each([[""], [1], [null], [undefined]])("throws on a name that is not a non-empty string: %j", (bad) => {
        expect(() => defineBoundary("B", /** @type {any} */ (["ok", bad]))).toThrow(/non-empty strings/);
    });

    it.each([[null], ["ping"], [undefined]])("throws when names is not an array or object: %j", (bad) => {
        expect(() => defineBoundary("B", /** @type {any} */ (bad))).toThrow(/names must be/);
    });

    it("throws when rules and names differ, naming both directions", () => {
        expect(() =>
            defineBoundary("worker", ["a", "b", "c"], { rules: { a: {}, d: {}, e: {} } })
        ).toThrow("Boundary worker: no rule for: b, c; rule for undeclared: d, e");
    });

    it("gives every message name a rule, and nothing else", () => {
        expect(() => defineBoundary("B", ["a"], { rules: { a: {} } })).not.toThrow();
        expect(() => defineBoundary("B", ["a"], { rules: {} })).toThrow(/no rule for: a/);
    });

    it("throws on a rule row that is not an object", () => {
        expect(() => defineBoundary("B", ["a"], { rules: { a: /** @type {any} */ (null) } })).toThrow(/rule for a must be an object/);
    });

    it("has() is true only for declared names and false for non-strings", () => {
        const b = defineBoundary("B", ["ping", "1"]);

        expect(b.has("ping")).toBe(true);
        expect(b.has("pong")).toBe(false);
        expect(b.has(1)).toBe(false);
        expect(b.has(undefined)).toBe(false);
        expect(b.has({ type: "ping" })).toBe(false);
        expect(b.has("toString")).toBe(false);
    });

    it("keeps two boundaries that share a wire value independent", () => {
        const tab = defineBoundary("TAB", ["features:update", "tab-only"], { rules: { "features:update": { from: "extension" }, "tab-only": {} } });
        const page = defineBoundary("PAGE", ["features:update"]);

        expect(tab.has("features:update")).toBe(true);
        expect(page.has("features:update")).toBe(true);
        expect(page.has("tab-only")).toBe(false);
        expect(tab.allows("features:update", "page")).toBe(false);
        expect(page.allows("features:update", "page")).toBe(true);
    });

    it("owns() rejects non-objects and undeclared types", () => {
        const b = defineBoundary("B", ["ping"]);

        expect(b.owns({ type: "ping" })).toBe(true);
        expect(b.owns({ type: "pong" })).toBe(false);
        expect(b.owns({})).toBe(false);
        expect(b.owns("ping")).toBe(false);
        expect(b.owns(null)).toBe(false);
    });

    it("owns() works as hermes-handler's shouldHandle", async () => {
        const b = defineBoundary("B", ["ping"]);
        const hermes = new HermesHandler(b.pair({ ping: () => "pong" }), { shouldHandle: b.owns, logger: null });
        const listener = hermes.getListener();

        expect(listener({ type: "other" }, {})).toBe(false);
        await expect(listener({ type: "ping" }, {})).resolves.toEqual({ ok: true, result: "pong" });
    });

    it("rule() returns the caller's row, {} without a rule, undefined when undeclared", () => {
        const row = { from: "page", feature: "ai" };
        const ruled = defineBoundary("B", ["a"], { rules: { a: row } });
        const plain = defineBoundary("B", ["a"]);

        expect(ruled.rule("a")).toBe(row);
        expect(Object.isFrozen(row)).toBe(false);
        expect(plain.rule("a")).toEqual({});
        expect(plain.rule("b")).toBeUndefined();
    });

    describe("allows", () => {
        const b = defineBoundary("B", ["any", "ext", "popup", "both", "listed-any"], {
            rules: {
                any: {},
                ext: { from: "extension" },
                popup: { from: "extension:popup" },
                both: { from: ["extension:popup", "page"] },
                "listed-any": { from: "any" },
            },
        });

        it.each([
            ["any", "page", true],
            ["any", "extension", true],
            ["listed-any", "page", true],
            ["ext", "extension", true],
            ["ext", "extension:popup", true],
            ["ext", "page", false],
            ["ext", "extensionx", false],
            ["ext", "extensionx:popup", false],
            ["popup", "extension:popup", true],
            ["popup", "extension", false],
            ["popup", "extension:options", false],
            ["popup", "extension:popupx", false],
            ["both", "extension:popup", true],
            ["both", "page", true],
            ["both", "extension", false],
            ["undeclared", "page", false],
        ])("%s from %s -> %s", (type, kind, expected) => {
            expect(b.allows(type, kind)).toBe(expected);
        });

        it.each(["any", "listed-any", "ext"])("is false for a null kind, always: %s", (type) => {
            expect(b.allows(type, null)).toBe(false);
            expect(b.allows(type, "")).toBe(false);
        });

        it("lets the trusted kind send everything, by the same prefix rule as from", () => {
            const t = defineBoundary("B", ["p"], { rules: { p: { from: "page" } }, trusted: "extension" });

            expect(t.allows("p", "extension")).toBe(true);
            expect(t.allows("p", "extension:popup")).toBe(true);
            expect(t.allows("p", "extensionx")).toBe(false);
            expect(t.allows("p", null)).toBe(false);
            expect(t.allows("undeclared", "extension")).toBe(false);
        });

        it("a trusted named page does not trust other extension pages", () => {
            const t = defineBoundary("B", ["p"], { rules: { p: { from: "page" } }, trusted: "extension:popup" });

            expect(t.allows("p", "extension:popup")).toBe(true);
            expect(t.allows("p", "extension")).toBe(false);
            expect(t.allows("p", "extension:options")).toBe(false);
        });

        it("trusted is off by default", () => {
            const t = defineBoundary("B", ["p"], { rules: { p: { from: "page" } } });
            expect(t.allows("p", "extension")).toBe(false);
        });
    });

    describe("pair", () => {
        const b = defineBoundary("worker", ["a", "b", "port", "slow", "never"], {
            rules: {
                a: {},
                b: { from: "page" },
                port: { port: true, timeoutMs: 5 },
                slow: { timeoutMs: 30000 },
                never: { timeoutMs: 0 },
            },
        });
        const fn = () => "x";

        it("returns the handlers, with { handler, timeoutMs } only where the rule sets a timeout", () => {
            const out = b.pair({ a: fn, b: fn, slow: fn, never: fn });

            expect(out).toEqual({ a: fn, b: fn, slow: { handler: fn, timeoutMs: 30000 }, never: { handler: fn, timeoutMs: 0 } });
            expect(out.a).toBe(fn);
            expect("port" in out).toBe(false);
        });

        it("throws on a missing handler, an undeclared handler and a handler for a port row, naming every type", () => {
            expect(() => b.pair({ a: fn, slow: /** @type {any} */ ("nope"), port: fn, extra: fn, other: fn })).toThrow(
                "Boundary worker: no handler function for: b, slow, never; handler for undeclared: extra, other; handler for port: port"
            );
        });

        it.each([
            ["a missing handler", { b: fn, slow: fn, never: fn }, /no handler function for: a$/],
            ["an undeclared handler", { a: fn, b: fn, slow: fn, never: fn, extra: fn }, /handler for undeclared: extra$/],
            ["a handler for a port row", { a: fn, b: fn, slow: fn, never: fn, port: fn }, /handler for port: port$/],
        ])("throws on %s", (_label, handlers, error) => {
            expect(() => b.pair(handlers)).toThrow(error);
        });

        it("does not take inherited properties as handlers", () => {
            const c = defineBoundary("C", ["toString"]);
            expect(() => c.pair({})).toThrow(/no handler function for: toString/);
        });

        it("feeds HermesHandler, which applies the rule's timeout", async () => {
            const t = defineBoundary("T", ["slow"], { rules: { slow: { timeoutMs: 20 } } });
            /** @type {AbortSignal | undefined} */
            let signal;
            const hermes = new HermesHandler(
                t.pair({ slow: (_msg, ctx) => { signal = ctx.signal; return new Promise(() => {}); } }),
                { timeoutMs: 10000, logger: null }
            );

            const res = await hermes.dispatch({ type: "slow" });

            expect(res).toEqual({ ok: false, error: "Handler slow timed out (20 ms)" });
            expect(signal?.aborted).toBe(true);
        });
    });
});

describe("classifySender", () => {
    it.each([
        ["an extension page", { url: `${ORIGIN}worker.html`, id: ID }, "extension"],
        ["a content script", CONTENT, "page"],
        ["a content script without an id", { url: "https://example.com/", tab: { id: 1 } }, "page"],
    ])("tells pages from content scripts by URL: %s", (_label, sender, expected) => {
        expect(classify(sender)).toBe(expected);
    });

    it.each([
        [`${ORIGIN}popup.html`, "extension:popup"],
        [`${ORIGIN}popup.html?tab=3`, "extension:popup"],
        [`${ORIGIN}popup.html#top`, "extension:popup"],
        [`${ORIGIN}popup.html?x=1#y`, "extension:popup"],
        [`${ORIGIN}options.html`, "extension"],
        [`${ORIGIN}popup.htmlx`, "extension"],
        [`${ORIGIN}sub/popup.html`, "extension"],
    ])("names listed pages, ignoring query and hash: %s", (url, expected) => {
        expect(classify({ url, id: ID })).toBe(expected);
    });

    it("treats a sender with a url and no tab as a page (Safari)", () => {
        expect(classify({ url: "https://example.com/" })).toBe("page");
    });

    it("treats a sender with a tab and no url as a page", () => {
        expect(classify({ tab: { id: 1 } })).toBe("page");
    });

    it.each([[null], [undefined], ["sender"], [42], [{}], [{ url: "" }], [{ url: 5 }]])("returns null for %j", (sender) => {
        expect(classify(sender)).toBeNull();
    });

    it("returns null for a mismatched sender.id and accepts a missing one", () => {
        expect(classify({ url: `${ORIGIN}popup.html`, id: "other" })).toBeNull();
        expect(classify({ url: `${ORIGIN}popup.html` })).toBe("extension:popup");
        expect(classifySender({ url: `${ORIGIN}x.html`, id: "other" }, { origin: ORIGIN })).toBe("extension");
    });

    it("does not match another extension whose id starts with ours", () => {
        expect(classify({ url: "chrome-extension://abcdefgh/popup.html", tab: undefined })).toBe("page");
        expect(classify({ url: "chrome-extension://abcdefgh/popup.html", id: "abcdefgh" })).toBe("page");
    });

    it("returns null for every sender when origin does not end with '/'", () => {
        const opts = { origin: "chrome-extension://abcdef" };
        expect(classifySender({ url: "chrome-extension://abcdefgh/x.html" }, opts)).toBeNull();
        expect(classifySender(CONTENT, opts)).toBeNull();
    });

    it("never throws", () => {
        const hostile = { get url() { throw new Error("boom"); } };
        expect(classifySender(hostile, { origin: ORIGIN })).toBeNull();
        expect(classifySender(CONTENT, /** @type {any} */ (null))).toBeNull();
        expect(classifySender(POPUP, /** @type {any} */ ({ origin: ORIGIN, pages: null }))).toBe("extension");
    });
});

describe("createGuard with a real HermesHandler", () => {
    const WORKER = defineBoundary("worker", Object.freeze({ PING: "ping", SAVE: "save", AI: "ai:run", PORT: "stream" }), {
        rules: {
            ping: { from: "any" },
            save: { from: "extension" },
            "ai:run": { from: "page", feature: "ai" },
            stream: { from: "page", port: true },
        },
    });
    const handlers = {
        ping: (/** @type {any} */ _msg, /** @type {any} */ ctx) => ({ sender: ctx.sender }),
        save: () => "saved",
        "ai:run": () => "ran",
    };

    /** @param {Parameters<typeof createGuard>[2]} [options] */
    function setup(options) {
        const logger = silent();
        const guard = createGuard(WORKER, classify, options);
        const hermes = new HermesHandler(WORKER.pair(handlers), { logger });
        hermes.use(guard.middleware);
        return { guard, hermes, logger };
    }

    it.each([
        ["ping", CONTENT, true],
        ["ping", POPUP, true],
        ["save", CONTENT, false],
        ["save", POPUP, true],
        ["save", OPTIONS_PAGE, true],
        ["ai:run", CONTENT, true],
        ["ai:run", POPUP, false],
    ])("accepts or refuses %s from %j as declared", async (type, sender, accepted) => {
        const { hermes } = setup();
        const res = await hermes.dispatch({ type }, sender);

        if (accepted) {
            expect(res.ok).toBe(true);
        } else {
            expect(res).toEqual({ ok: false, error: `${type} is not accepted from this sender.`, info: { code: "SENDER_REFUSED", type } });
        }
    });

    it("refuses a sender that is neither, an unknown name and a gated message, in that order", async () => {
        const gate = vi.fn((/** @type {any} */ rule) => (rule.feature === "ai" ? { ok: false, error: "held", code: "FEATURE_HELD" } : null));
        const { guard } = setup({ gate });

        expect(guard.check("nope", {})).toEqual({ ok: false, error: "Unknown msg.type: nope", info: { code: "UNKNOWN_TYPE", type: "nope" } });
        expect(guard.check("ai:run", {})).toEqual({ ok: false, error: "ai:run is not accepted from this sender.", info: { code: "SENDER_REFUSED", type: "ai:run" } });
        expect(gate).not.toHaveBeenCalled();
        expect(guard.check("ai:run", CONTENT)).toEqual({ ok: false, error: "held", code: "FEATURE_HELD" });
        expect(guard.check("ping", CONTENT)).toBeNull();
    });

    it("hands gate the caller's rule, the kind, the sender and the message", () => {
        const gate = vi.fn(() => undefined);
        const { guard } = setup({ gate });
        const msg = { type: "ai:run", payload: { secret: 1 } };

        expect(guard.check("ai:run", CONTENT, msg)).toBeNull();
        expect(gate).toHaveBeenCalledWith(WORKER.rule("ai:run"), { type: "ai:run", kind: "page", sender: CONTENT, msg });
    });

    it("lets a trusted extension page send a from: 'page' message", async () => {
        const b = defineBoundary("B", ["p"], { rules: { p: { from: "page" } }, trusted: "extension" });
        const guard = createGuard(b, (s) => classifySender(s, { origin: ORIGIN }));
        const hermes = new HermesHandler(b.pair({ p: () => "ok" }), { logger: null }).use(guard.middleware);

        await expect(hermes.dispatch({ type: "p" }, POPUP)).resolves.toEqual({ ok: true, result: "ok" });
        await expect(hermes.dispatch({ type: "p" }, {})).resolves.toMatchObject({ info: { code: "SENDER_REFUSED" } });
    });

    it("from: 'extension:popup' refuses other extension pages", async () => {
        const b = defineBoundary("B", ["p"], { rules: { p: { from: "extension:popup" } } });
        const hermes = new HermesHandler(b.pair({ p: () => "ok" }), { logger: null }).use(createGuard(b, classify).middleware);

        await expect(hermes.dispatch({ type: "p" }, POPUP)).resolves.toEqual({ ok: true, result: "ok" });
        await expect(hermes.dispatch({ type: "p" }, OPTIONS_PAGE)).resolves.toMatchObject({ info: { code: "SENDER_REFUSED" } });
        await expect(hermes.dispatch({ type: "p" }, CONTENT)).resolves.toMatchObject({ info: { code: "SENDER_REFUSED" } });
    });

    it("leaves the runtime sender on ctx.sender for the handler", async () => {
        const { hermes } = setup();
        const res = await hermes.dispatch({ type: "ping" }, CONTENT);

        expect(res).toEqual({ ok: true, result: { sender: CONTENT } });
        expect(/** @type {any} */ (res).result.sender).toBe(CONTENT);
    });

    it("keeps info.code, echoes requestId and logs nothing on a refusal through use()", async () => {
        const { hermes, logger } = setup();

        const refused = await hermes.dispatch({ type: "save", requestId: "r1" }, CONTENT);
        const unknown = await hermes.dispatch({ type: "nope", requestId: "r2" }, CONTENT);

        expect(refused).toEqual({ ok: false, error: "save is not accepted from this sender.", info: { code: "SENDER_REFUSED", type: "save" }, requestId: "r1" });
        expect(unknown).toEqual({ ok: false, error: "Unknown msg.type: nope", info: { code: "UNKNOWN_TYPE", type: "nope" }, requestId: "r2" });
        for (const level of ["debug", "info", "warn", "error"]) {
            expect(/** @type {any} */ (logger)[level]).not.toHaveBeenCalled();
        }
    });

    it("stops a refused message before the handler and later middleware", async () => {
        const handler = vi.fn(() => "saved");
        const later = vi.fn((_msg, _ctx, next) => next());
        const guard = createGuard(WORKER, classify);
        const hermes = new HermesHandler(WORKER.pair({ ...handlers, save: handler }), { logger: null })
            .use(guard.middleware)
            .use(later);

        await hermes.dispatch({ type: "save" }, CONTENT);
        expect(handler).not.toHaveBeenCalled();
        expect(later).not.toHaveBeenCalled();

        await hermes.dispatch({ type: "save" }, POPUP);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(later).toHaveBeenCalledTimes(1);
    });

    it("checks a port row by name without a handler", () => {
        const { guard } = setup();

        expect(guard.check("stream", CONTENT)).toBeNull();
        expect(guard.check("stream", POPUP)).toMatchObject({ info: { code: "SENDER_REFUSED", type: "stream" } });
    });

    it("times a handler out at its own limit and aborts ctx.signal", async () => {
        const b = defineBoundary("B", ["slow"], { rules: { slow: { timeoutMs: 25 } } });
        /** @type {AbortSignal | undefined} */
        let signal;
        const hermes = new HermesHandler(
            b.pair({ slow: (_msg, ctx) => { signal = ctx.signal; return new Promise(() => {}); } }),
            { timeoutMs: 10000, logger: null }
        ).use(createGuard(b, classify).middleware);

        const res = await hermes.dispatch({ type: "slow" }, CONTENT);

        expect(res.ok).toBe(false);
        expect(/** @type {any} */ (res).error).toContain("timed out");
        expect(signal?.aborted).toBe(true);
    });

    it("turns a gate that throws into an error envelope through middleware", async () => {
        const { hermes } = setup({ gate: () => { throw new Error("gate broke"); } });

        await expect(hermes.dispatch({ type: "ping" }, CONTENT)).resolves.toEqual({ ok: false, error: "gate broke" });
    });

    it("does not read msg.payload", async () => {
        const { hermes } = setup();
        const msg = { type: "save", get payload() { throw new Error("payload read"); } };

        await expect(hermes.dispatch(msg, CONTENT)).resolves.toMatchObject({ info: { code: "SENDER_REFUSED" } });
    });
});
