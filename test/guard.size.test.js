// test/guard.size.test.js
//
// Size gate for `hermes-handler/guard`. Each entry keeps the imports alive by
// assigning them to a global, bundled with esbuild (bundle, minify, iife) and
// gzipped at level 9. The same entry with nothing imported is subtracted so the
// numbers are what the guard adds to a consumer bundle.

import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIMIT_GZIP = 1300;

/** @param {string[]} names */
async function measure(names) {
    const imports = names.length ? `import { ${names.join(", ")} } from "./src/guard.js";\n` : "";
    const result = await build({
        stdin: { contents: `${imports}globalThis.__guard = [${names.join(", ")}];`, loader: "js", resolveDir: ROOT },
        bundle: true,
        minify: true,
        format: "iife",
        write: false,
        logLevel: "silent",
    });
    const code = result.outputFiles[0].contents;
    return { min: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

describe("guard bundle size", () => {
    it(`all three exports add at most ${LIMIT_GZIP} B gzip`, async () => {
        const base = await measure([]);
        const one = await measure(["defineBoundary"]);
        const all = await measure(["defineBoundary", "classifySender", "createGuard"]);
        const sizes = {
            defineBoundary: { min: one.min - base.min, gzip: one.gzip - base.gzip },
            all: { min: all.min - base.min, gzip: all.gzip - base.gzip },
        };
        console.info("[guard size]", JSON.stringify(sizes));
        expect(sizes.defineBoundary.gzip).toBeGreaterThan(0);
        expect(sizes.all.gzip).toBeLessThanOrEqual(LIMIT_GZIP);
    });
});
