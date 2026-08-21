# Vercel notes

The notes that used to live inside `vercel.json` as a `"//"` key. Vercel
validates that file against a strict schema and rejects unknown properties, so
JSON-comment conventions that work in `package.json` fail there.

## Settings

- **Root Directory: `web`.** Without it Vercel builds from the repository root,
  finds `api/pyproject.toml`, and builds the FastAPI backend as a Python project
  instead of the frontend. The give-away in the build log is `Using Python 3.12`
  and no `npm ci`.

- **`VITE_API_BASE`** must point at the deployed API origin, e.g.
  `https://sqlproj-api.onrender.com`, with no trailing slash. Vite inlines
  `VITE_*` at **build** time, so setting it after a deploy requires a redeploy
  to take effect.

- **Never put a secret in a Vercel environment variable here.** This is a static
  build with no serverless functions, so a `VITE_`-prefixed value is compiled
  into the public JS bundle. Database credentials and the model API key belong
  on Render.

## Deliberate omissions

No SPA catch-all rewrite. `App.tsx` switches tabs with `useState` and there is
no client-side router, so `/` is the only real route; a catch-all would turn
genuine 404s into a silently blank `index.html`.
