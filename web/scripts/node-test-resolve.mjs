/**
 * Let `node --test` resolve the app's own imports.
 *
 * The source imports siblings without an extension - `./urlState`, not
 * `./urlState.ts` - because Vite resolves them and TypeScript is configured to
 * expect that. Node is not a bundler and will not guess, so importing any real
 * module from a test fails on the first internal import.
 *
 * The alternative was to add `.ts` to every internal import in the codebase,
 * which changes ~40 lines of application code to suit the test runner. This
 * changes none of them. Node strips the types itself, so there is still no test
 * framework, no transpiler and no new dependency in the tree.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    // Only relative specifiers with no extension at all. A bare package name
    // must keep going to node_modules, and `./foo.js` must stay `./foo.js`.
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* fall through to the real resolver so the error names the real path */
      }
    }
    return next(specifier, context);
  },
});
