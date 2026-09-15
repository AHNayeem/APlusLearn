import { fileURLToPath, pathToFileURL } from "node:url";
import { statSync } from "node:fs";
import path from "node:path";

/**
 * Module resolution hook for `scripts/integration-tests.mjs`.
 *
 * Teaches plain Node the three things Next.js does for the application code:
 * the `@/*` import alias, extensionless relative imports, and the
 * `server-only` marker package. Nothing else is intercepted, so the tests
 * exercise the real modules rather than copies of them.
 */
const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const EXTENSIONS = ["", ".js", ".jsx", ".mjs", "/index.js", "/index.jsx"];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * The first of the candidate spellings that is an actual file. A bare
 * directory is not a module: `@/models` must land on its index.js, or the
 * loader ends up trying to read a folder.
 */
function firstFile(base) {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: new URL("./empty.mjs", import.meta.url).href, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const resolved = firstFile(path.join(SRC, specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    throw new Error(`Could not resolve "${specifier}" under src/.`);
  }

  // Application code omits file extensions on relative imports too.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parent = path.dirname(fileURLToPath(context.parentURL));
    if (parent.startsWith(SRC)) {
      const resolved = firstFile(path.resolve(parent, specifier));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
