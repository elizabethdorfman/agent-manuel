# Agent Manuel landing page

A self-contained static site. `index.html` has its images built in, so it works when opened directly. `assets/` keeps the original image files for editing.

## Deploy on Railway

1. In Railway, create a new service from the `elizabethdorfman/agent-manuel` GitHub repo.
2. In the service settings, set **Root Directory** to `site`.
3. Railway detects Node from `package.json` and runs `npm start`, which serves this folder on Railway's `$PORT`.
4. Under **Networking**, generate a domain or attach your own.

## Run locally

```sh
cd site && npm start   # http://localhost:3000
```
