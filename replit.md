# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### BBGE — BuyBudi Generic Extractor
- **Frontend**: `artifacts/bbge` — React + Vite, Tailwind CSS, dark terminal theme
- **Backend**: `artifacts/api-server/src/routes/bbge/` + `services/bbge/`
- **Preview path**: `/bbge/`
- **Purpose**: Extracts structured listing data from marketplace URLs (Facebook Marketplace, Gumtree, eBay, Craigslist, Generic)
- **Pipeline**: metadata → Playwright browser → AI vision (requires OPENAI_API_KEY) → user-assisted fallback
- **Key files**:
  - `artifacts/bbge/src/pages/home.tsx` — main UI
  - `artifacts/api-server/src/services/bbge/extractionPipeline.ts` — pipeline orchestrator
  - `artifacts/api-server/src/services/bbge/platformDetector.ts` — URL-based platform detection
  - `lib/api-spec/openapi.yaml` — OpenAPI spec (bbgeHealth + bbgeExtract endpoints)
- **Installed packages** (api-server): `cheerio`, `playwright`, `openai`, `uuid`
- **vite.config.ts**: PORT and BASE_PATH default to 3000 and /bbge/ if env vars not set
