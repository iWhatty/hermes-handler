import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "dist", "node_modules"]);

/** @param {string} text */
function maskCode(text) {
    const mask = (value) => value.replace(/[^\r\n]/g, " ");
    return text
        .replace(/^[ \t]*```[^\r\n]*[\r\n]+[\s\S]*?^[ \t]*```[ \t]*$/gm, mask)
        .replace(/^[ \t]*~~~[^\r\n]*[\r\n]+[\s\S]*?^[ \t]*~~~[ \t]*$/gm, mask)
        .replace(/`[^`\r\n]*`/g, mask);
}

/** @param {string} text */
function extractInlineLinks(text) {
    const links = [];
    let cursor = 0;

    while ((cursor = text.indexOf("](", cursor)) !== -1) {
        const start = cursor + 2;
        let depth = 1;
        let escaped = false;
        let end = start;

        for (; end < text.length; end += 1) {
            const char = text[end];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === "(") depth += 1;
            if (char === ")") {
                depth -= 1;
                if (depth === 0) break;
            }
        }

        if (depth === 0) {
            links.push({ raw: text.slice(start, end), index: start });
            cursor = end + 1;
        } else {
            cursor = start;
        }
    }

    return links;
}

/** @param {string} text */
function extractReferenceLinks(text) {
    const links = [];
    const pattern = /^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(?:<([^>\r\n]+)>|(\S+))/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const raw = match[1] ?? match[2];
        links.push({ raw, index: match.index + match[0].indexOf(raw) });
    }
    return links;
}

/** @param {string} raw */
function linkDestination(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("<")) {
        const close = trimmed.indexOf(">");
        return close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
    }

    let escaped = false;
    for (let index = 0; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (/\s/.test(char)) return trimmed.slice(0, index);
    }
    return trimmed;
}

/** @param {string} target */
function localTarget(target) {
    if (!target || target.startsWith("#") || target.startsWith("//")) return null;
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;

    const pathOnly = target.split(/[?#]/, 1)[0];
    if (!pathOnly || pathOnly.startsWith("/")) return null;

    const unescaped = pathOnly.replace(/\\([\\()[\]<> ])/g, "$1");
    try {
        return decodeURIComponent(unescaped);
    } catch {
        return unescaped;
    }
}

/** @param {string} text @param {number} index */
function lineNumber(text, index) {
    return text.slice(0, index).split(/\r\n|\r|\n/).length;
}

/** @param {string} directory */
async function markdownFiles(directory) {
    const files = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await markdownFiles(entryPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            files.push(entryPath);
        }
    }
    return files;
}

const failures = [];
const files = (await markdownFiles(rootDir)).sort();

for (const sourcePath of files) {
    const source = await readFile(sourcePath, "utf8");
    const visible = maskCode(source);
    const links = [
        ...extractInlineLinks(visible),
        ...extractReferenceLinks(visible),
    ];

    for (const link of links) {
        const destination = linkDestination(link.raw);
        const target = localTarget(destination);
        if (target === null) continue;

        const normalizedTarget = target.replace(/[\\/]/g, sep);
        const resolvedTarget = resolve(dirname(sourcePath), normalizedTarget);
        const fromRoot = relative(rootDir, resolvedTarget);
        const outsideRoot = fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);

        let exists = false;
        if (!outsideRoot) {
            try {
                await stat(resolvedTarget);
                exists = true;
            } catch {
                exists = false;
            }
        }

        if (!exists) {
            failures.push({
                source: relative(rootDir, sourcePath),
                line: lineNumber(source, link.index),
                target: destination,
            });
        }
    }
}

if (failures.length > 0) {
    console.error(`Broken documentation links (${failures.length}):`);
    for (const failure of failures) {
        console.error(`- ${failure.source}:${failure.line} -> ${failure.target}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Documentation links OK (${files.length} Markdown files checked).`);
}
