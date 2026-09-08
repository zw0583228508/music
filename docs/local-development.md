# Local development (off-Replit)

The deployment target is Replit (Linux x64) with Replit Object Storage and
Replit OIDC. This guide runs the **TypeScript core** — API server + web studio +
Postgres — on a local machine. The Python model workers in `services/*` target
Modal + CUDA and stay offline locally; the studio does not fabricate candidates
when workers are unavailable.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x | |
| pnpm | 10.x | `corepack enable` |
| PostgreSQL | 16 | local server on `:5432` |
| FFmpeg / FFprobe | 6+ | on `PATH`, used by source analysis |

## One-time setup

```bash
pnpm install

# Postgres database
createdb -U postgres music_studio        # or: psql -U postgres -c 'create database music_studio;'

cp .env.local.example .env.local
# edit .env.local — set DATABASE_URL to your local Postgres

# create the schema
pnpm run db:push
```

## Run

Two terminals:

```bash
# terminal 1 — API server on :5000
pnpm run dev:api

# terminal 2 — web studio on :5173 (proxies /api to :5000)
pnpm run dev:studio
```

Then:

1. Open <http://localhost:5173>.
2. Visit <http://localhost:5173/api/dev-login> once — this mints a local session
   cookie (Replit OIDC is bypassed) and redirects back to the app.
3. You are signed in as `dev@localhost`.

## What the local harness changes (all deploy-safe, opt-in)

| Concern | Production | Local |
|---|---|---|
| Object storage | Replit Object Storage (GCS sidecar) | filesystem under `LOCAL_OBJECT_STORAGE_DIR`, via `MUSIC_OBJECT_STORAGE_DRIVER=local` (`lib/localObjectStore.ts`) |
| Auth | Replit OIDC (`routes/auth.ts`) | `routes/devAuth.ts`, mounted only when `NODE_ENV!=='production'` **and** `DEV_AUTH_ENABLED==='true'` |
| `/api` origin | same-origin | `vite.config.ts` dev proxy → `API_PROXY_TARGET` (default `http://localhost:5000`) |

None of these are reachable on the deployed path.

## Known limitations

- `pnpm run build` / `vite build` fail on **Windows**: `pnpm-workspace.yaml`
  strips every non-linux native binary (rollup, lightningcss, tailwind-oxide),
  so the Windows rollup binary is unavailable. The `vite` **dev** server does not
  use it and works. Production bundling still works on Linux/CI/Replit. Build on
  WSL2 if you need a Windows-local production bundle.
- Model workers are offline: analysis stages that require a GPU provider and all
  generation candidates are unavailable locally. Source import, preprocessing,
  the baseline FFmpeg analyzer, Song Model persistence/validation, arrangement
  planning, track models, harmony/quality engines, and the studio UI all work.
