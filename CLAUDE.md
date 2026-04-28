# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Express + Vite HMR on port 5000)
npm run build      # Production build: Vite → dist/public, esbuild → dist/index.cjs
npm start          # Run production build
npm run check      # TypeScript type checking (no ESLint/Prettier configured)
npm run db:push    # Push Drizzle schema changes to PostgreSQL
```

No test framework is configured.

## Architecture

BuyBudi is an escrow/deal-management platform where buyers and sellers transact second-hand goods. A "deal" is the core entity: it moves through a 21-state machine (DEAL_INITIATED → CLOSED or CANCELLED) with role-gated transitions.

### Stack

- **Frontend**: React 18 + Vite, wouter routing, TanStack Query for server state, React Hook Form + Zod for forms, shadcn/ui (Radix primitives) + Tailwind CSS
- **Backend**: Express 5 + TypeScript, Passport.js local strategy with express-session, multer for file uploads, WebSocket (ws)
- **Database**: PostgreSQL 16 via Drizzle ORM; schemas defined in `shared/schema.ts` and exported as Zod types used on both client and server
- **AI/External**: OpenAI (checklist generation, risk assessment), eBay Browse API (OAuth2), Facebook Marketplace scraper, Tesseract.js OCR

### Key directories

| Path | Purpose |
|---|---|
| `shared/schema.ts` | Single source of truth for DB tables, enums, and Zod validation types |
| `server/routes.ts` | All API endpoints (~47 KB); `requireAuth` middleware guards every route |
| `server/storage.ts` | `DatabaseStorage` class (implements `IStorage`) — all DB queries live here |
| `server/auth.ts` | Passport setup, bcrypt hashing, session config with pg store |
| `server/db.ts` | PostgreSQL connection pool |
| `client/src/pages/deal-workspace.tsx` | Main deal UI (~46 KB); largest page component |
| `client/src/pages/risk-check.tsx` | Risk assessment UI (~77 KB) |
| `client/src/lib/queryClient.ts` | TanStack Query client + shared `apiRequest` helper |

### Data flow

1. React pages call `useQuery`/`useMutation` → `apiRequest` → Express route
2. Routes validate with Zod, check auth/role, then call `storage.*` methods
3. `DatabaseStorage` executes Drizzle queries against PostgreSQL
4. Shared Zod schemas (from `shared/schema.ts`) validate at both the API boundary and form level

### Authentication & roles

Four roles: `BUYER`, `SELLER`, `SUPPORT`, `ADMIN`. Session-based (Passport local + express-session stored in PostgreSQL). Routes enforce role checks inline after `requireAuth`.

### Deal state machine

States live in the `deals` table (`state` column, enum). Transitions are enforced in `server/routes.ts` `PATCH /api/deals/:id`. The workspace UI renders different action buttons per state + role combination.

### Listing import

`POST /api/risk/import-listing` dispatches via `server/importers/index.ts` using a registry pattern — adding a new platform is a single push to `REGISTRY` with a URL-test predicate and an async importer. All importers return a uniform `ImportedListing` shape (nullable fields for graceful degradation).

**Per-platform status:**

| Platform | Status | Notes |
|---|---|---|
| Facebook Marketplace | Live | HTML + Open Graph parse; hits login wall frequently → falls back to screenshot upload + manual form |
| eBay | Stubbed | `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` already provisioned; ready for Browse API implementation |
| Gumtree | Stubbed | No public API; would replicate the FB pattern (HTML scrape → screenshot fallback) |

**`importStatus` ladder** (4 states the UI must handle): `success` → green badge; `partial` → amber badge + prompt to review; `insufficient` → show screenshot upload zone; `failed` → blank form, manual entry.

There are two parallel marketplace taxonomies to keep in sync when adding a platform: the `marketplace` enum in `shared/schema.ts` (`FBM`, `EBAY`, `GUMTREE`, `OTHER`) and `ImportedListing.source` (`facebook_marketplace`, `ebay`, `gumtree`, `unsupported`).

### Path aliases (TypeScript + Vite)

- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

### Conventions to preserve (load-bearing, per audit)

- **No "escrow" in user-facing copy** — use "Protected Deal", "held", "released", "secured".
- **Custom accordion** (`components/custom-accordion.tsx`) over shadcn's — the shadcn primitive triggers HMR re-render loops in this project.
- **`data-testid` on all interactive elements** — pattern is `{action}-{target}` for interactive, `{type}-{content}` for display, `card-deal-${dealCode}` for dynamic lists.
- **`varchar` UUID primary keys** — do not migrate to `serial`; it generates destructive `ALTER TABLE` statements.
- **`VALID_TRANSITIONS` map** and the 21-state enum — every UI surface keys off it; changes ripple everywhere.
- **`ImportedListing` shape** — consumed by the risk engine, deal wizard, and persisted risk reports; breaking changes ripple everywhere.
- **Numeric DB columns** (`priceAmount`, ledger `amount`) are `numeric` type → string at runtime in JS; always `Number(...)` before formatting.
- **TanStack Query keys are arrays**, never template strings — `['/api/deals', dealId]` — so cache invalidation by prefix works.

### Phase 2 roadmap (from audit)

Sequenced as ~7 engineering sprints:

1. **Token & layout polish** — promote `#1e40af` / `#1e3a5f` chrome hexes to named CSS tokens, audit `dark:` coverage
2. **Landing decomposition** — split `landing.tsx` (1,150 LOC) into a `landing/` folder, one file per section
3. **Wizard collapse** — rework `/deals/new` into 3 steps (URL → Confirm → Invite) collapsing steps 2+3 when import succeeds
4. **Workspace clarity** — re-tier Pass/Fail vs Open-Dispute button weights, embed compact 21-state visualiser in `transaction-timeline.tsx`
5. **Risk Check polish** — split buyer-mode form into 2 steps, add shareable read-only report link
6. **Real-time layer** — SSE/WebSocket for messages + notifications (currently polled every 5 s via TanStack Query)
7. **Importer expansion** — eBay (Browse API, credentials already provisioned) + Gumtree (HTML scrape → screenshot fallback)

## BBGE Extraction Layer (Apify)

BBGE (BuyBudi Generic Extractor) is a separate extraction pipeline in `artifacts/api-server/` that uses Apify actors as the primary extraction strategy for platforms that block direct scraping.

| Platform | Method order | Confidence | Known limitations |
|---|---|---|---|
| Facebook Marketplace | `apify` → `ai_vision` (actor: `apify/facebook-marketplace-scraper`) | 95% | Seller name/profile unavailable without authenticated cookies; login wall detection built in (`facebookLoginWall.ts`) |
| Gumtree AU | `apify` → `rendered_browser` (actor: `memo23/gumtree-cheerio`) | 95% | Full seller data including member-since date available. `crawlerbros/gumtree-scraper` removed — consistently returned empty. |
| Depop | `rendered_browser` only (no Apify actor) | 95% | Seller name extracted from `og:description` and visible text. Location unavailable — platform limitation without login. |
| Craigslist | `apify` → `rendered_browser` | 95% | — |
| eBay | `metadata` → `rendered_browser` (no Apify) | 95% | No Apify needed; works well via metadata + browser selectors |
| Generic / unknown | `metadata` → `rendered_browser` | 30% | — |

**Key files:**

| File | Purpose |
|---|---|
| `artifacts/api-server/src/services/bbge/apifyExtractor.ts` | Apify integration |
| `artifacts/api-server/src/services/bbge/extractionPipeline.ts` | Orchestrator |
| `artifacts/api-server/src/config/bbge/platformConfigs.ts` | Method order per platform |
| `artifacts/api-server/src/services/bbge/normalizer.ts` | Unified output schema |

**Environment variable required:** `APIFY_API_TOKEN` (set in Replit Secrets)

**Pending:** Facebook seller data requires `curious_coder/facebook-marketplace` actor with FB session cookies — waiting for FB account verification.

### Deployment

Targets Replit autoscale. Build output: `dist/public` (static) + `dist/index.cjs` (server). Requires `DATABASE_URL` env var. OpenAI API key is managed by Replit's AI integration. eBay credentials: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_API_ENV`.
