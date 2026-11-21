import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = resolve(rootDir, "examples");

/** @param {string} directory */
async function exampleFiles(directory) {
    const files = [];
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await exampleFiles(entryPath));
        } else if (entry.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) {
            files.push(entryPath);
        }
    }

    return files;
}

const files = (await exampleFiles(examplesDir)).sort();
const failures = [];

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
        shell: false,
    });

    if (result.error || result.status !== 0) {
        failures.push({
            file: relative(rootDir, file),
            detail: result.error?.message ?? result.stderr.trim() ?? `Node exited with status ${result.status}`,
        });
    }
}

if (failures.length > 0) {
    console.error(`Example syntax failures (${failures.length}):`);
    for (const failure of failures) {
        console.error(`\n- ${failure.file}`);
        if (failure.detail) console.error(failure.detail);
    }
    process.exitCode = 1;
} else {
    console.log(`Example syntax OK (${files.length} JavaScript files checked).`);
}
