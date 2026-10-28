# DocuChat

DocuChat is a backend API for chatting with your documents. Users upload documents, a background worker extracts, chunks, and embeds them into PostgreSQL with pgvector, and users can then ask questions that are answered from their own documents with cited sources (RAG). A tool-calling research agent can also search across documents over several steps.

It's built with **Node.js, TypeScript, and Express 5**. It uses **PostgreSQL + pgvector** (through Prisma) for storage and vector search, **Redis** for caching, rate limiting, and budgets, **BullMQ** for background jobs, and **OpenAI** for embeddings and completions.

## Features

### Core API
- **Authentication:** register, log in, log out, and refresh tokens, using short-lived JWT access tokens and stored, revocable refresh tokens. Passwords are hashed with bcrypt.
- **Role-based access control (RBAC):** roles (`admin`, `member`, `viewer`) map to fine-grained permissions such as `documents:create`. Permissions are cached in Redis.
- **Documents:** create, list (paginated, filterable, sortable), get, and soft-delete documents, plus a processing-status endpoint that reports job progress.
- **Conversations:** list conversations and send messages. Each message records prompt/completion tokens and cost.
- **Usage logging:** user actions, tokens, and cost are recorded in `UsageLog` through domain events.

### Document ingestion pipeline
Runs in a separate worker process (`src/worker.ts`):
1. **Extract** text by format: `txt`, `md`, `pdf`, `docx`, `html`, `xlsx`, `csv` (pdf-parse, mammoth, cheerio, exceljs).
2. **Chunk** with recursive, separator-based splitting (500 tokens max, 50-token overlap, 50-token minimum), keeping character offsets per chunk.
3. **Embed** with `text-embedding-3-small` (1536 dimensions) in batches of 100. Embeddings are cached in Redis for 7 days, keyed by a SHA-256 hash of the content.
4. **Store** vectors in `Chunk.embedding`, indexed with an HNSW cosine index (`m=16`, `ef_construction=64`).

Jobs retry 3 times with backoff (worker concurrency 3). Jobs that exhaust their retries go to a dead-letter queue and the document is marked `failed`.

### RAG (retrieval-augmented generation)
- **Semantic search** over pgvector, always filtered to the requesting user's documents (top 10, minimum score 0.3).
- **Context assembly** within a 3,500-token budget, dropping redundant chunks and citing sources.
- Answers are generated through the AI gateway (below).

### AI gateway (`services/mcp.service.ts`)
Every chat completion goes through `mcpComplete`, which:
- **Enforces a monthly budget per tier** (free $1, pro $20, enterprise $200), tracked in Redis, with a warning at 80% and a `BUDGET_EXHAUSTED` error at 100%.
- **Loads the active prompt version** from the `PromptTemplate` table (cached for 5 minutes), so prompts can be versioned and switched without a deploy.
- **Routes to a model per task type** (`chat` and `summary` → `gpt-4o-mini`, `agent` → `gpt-4o`) and **falls back** to the other model if the first one fails.
- **Writes an audit log** entry (`AIAuditLog`) with model, prompt version, tokens, cost, latency, whether fallback was used, and short input/output summaries.

OpenAI calls go through an axios client with retries and an opossum **circuit breaker**.

### Research agent (`agents/`)
A tool-calling agent that loops through think → act → observe steps. It stops when it calls `final_answer`, or at 10 iterations, 60 seconds, or $0.50 spent, and keeps a trace of each step.
- Tools: `search_documents` (semantic search scoped to the user) and `final_answer` (answer, sources, confidence). Tool schemas are written in Zod and converted to OpenAI function-calling format.
- Emits `agent:completed`, which writes a usage log entry and updates metrics.

### Security
- Helmet with a strict Content Security Policy (relaxed only for Swagger UI), and a CORS allowlist (`FRONTEND_URL`).
- **Redis-backed rate limiting**: auth (10 per 15 minutes per IP), general API, uploads, and chat. The API, upload, and chat limits scale with the user's tier.
- Zod validation of environment variables and requests, and XSS input sanitization. A prompt sanitizer for user input sent to the model is written in `lib/promptSanitizer.ts` but not yet used.
- HMAC-SHA256 webhook signature verification with a timing-safe comparison, and idempotent webhook handling via the `WebhookEvent` table.
- Request fingerprinting and suspicious-access detection middleware *(written, not yet mounted)*.

### Performance and observability
- Redis caching with per-entity TTLs and event-driven invalidation.
- ETag / conditional `GET` support (`304 Not Modified`) on document and conversation reads.
- Structured logging with Pino, and a correlation ID on every request (read from or returned in `X-Correlation-Id`) that is passed through to workers and AI calls.
- **Prometheus metrics** at `/metrics`: HTTP request counts and latency, documents processed, active queue jobs, cache operations, ingestion duration, chunks per document, embedding cache hit rate, agent iterations, agent cost, and agent termination reasons.
- Liveness and readiness probes (`/health/live`, `/health/ready`, which checks the database and Redis).
- **Bull Board** dashboard for the document and dead-letter queues at `/admin/queues`.
- **API docs:** Swagger UI at `/api-docs`, with the raw spec at `/api-docs.json`.

## Architecture

```
            ┌──────────────┐   enqueue    ┌────────────┐    ┌──────────────────────────────┐
 Client ──▶ │  API server  │ ───────────▶ │   Redis    │ ─▶ │ Worker (src/worker.ts)        │
            │ (src/server) │              │  (BullMQ)  │    │ extract → chunk → embed → save│
            └──────┬───────┘              └────────────┘    └──────────────┬───────────────┘
                   │ RAG / agent                                           │
                   ▼                                                       ▼
            ┌──────────────┐  semantic search  ┌──────────────────────────────────┐
            │  AI gateway  │ ◀───────────────▶ │ PostgreSQL + pgvector (HNSW)     │
            │ (mcpComplete)│ ── audit log ───▶ │ users, docs, chunks, prompts ... │
            └──────┬───────┘                   └──────────────────────────────────┘
                   ▼
                OpenAI (via retry + circuit breaker)
```

## Project structure

```
src/
  server.ts        # API entry point (starts the HTTP server)
  worker.ts        # Worker entry point (processes document jobs, graceful shutdown)
  app.ts           # Express app, middleware, and route mounting
  agents/          # Research agent executor and tools (search_documents, final_answer)
  config/          # Swagger, Bull Board, and system prompts
  controllers/     # Request handlers
  routes/          # Route definitions (auth, documents, chat, admin, health, agent, webhooks)
  services/        # Business logic (auth, rbac, documents, conversations, embeddings,
                   #   search, rag, mcp = AI gateway)
  repositories/    # Database access through Prisma
  middleware/      # authenticate, authorize, validate, rate limiting, sanitize, etag,
                   #   request logging, metrics, webhook verification, error handler
  validators/      # Zod request schemas
  queues/          # BullMQ connection, document/embedding/dead-letter queues, workers
  events/          # Domain event listeners (auth, admin, documents, cache, security,
                   #   ingestion, agent)
  lib/             # config, prisma, cache, logger, metrics, tokens, errors, chunker,
                   #   document extractor, prompt sanitizer
  lib/http/        # OpenAI client, retry logic, circuit breaker
prisma/
  schema.prisma    # Database schema
  migrations/      # SQL migrations (including pgvector and the HNSW index)
  seed.ts          # Seeds roles, permissions, and v1 prompt templates
tests/
  integration/     # RAG retrieval quality tests (Vitest)
```

### Data model

| Model | Purpose |
|-------|---------|
| `User` | Account, `tier` (free/pro/enterprise), soft delete |
| `Role`, `Permission`, `UserRole`, `RolePermission` | RBAC |
| `RefreshToken` | Stored, revocable refresh tokens |
| `Document` | Uploaded content, processing `status`, `chunkCount`, soft delete |
| `Chunk` | Document chunk plus its `vector(1536)` embedding |
| `Conversation`, `Message` | Chat history with per-message tokens and cost |
| `UsageLog` | Per-user action, token, and cost log |
| `WebhookEvent` | Received webhooks, for idempotency |
| `PromptTemplate` | Versioned system prompts per task type, with an active flag |
| `AIAuditLog` | One row per AI call: model, prompt version, tokens, cost, latency, fallback |

## Prerequisites (Linux and macOS)

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ (LTS recommended) | Install with [nvm](https://github.com/nvm-sh/nvm) |
| npm | Comes with Node | |
| PostgreSQL | 14+ | Required |
| pgvector | 0.5+ | Postgres extension, required for embeddings and the HNSW index |
| Redis | 6+ | Required for jobs, caching, rate limiting, and budgets |
| OpenAI API key | | Required for ingestion, chat, and the agent |
| Git | Any | |

### Install on macOS (Homebrew)

```bash
# Homebrew (skip if already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node postgresql@16 pgvector redis
brew services start postgresql@16
brew services start redis
```

### Install on Linux (Ubuntu/Debian)

```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts

# PostgreSQL, pgvector, and Redis
# (replace 16 with your Postgres major version; pgvector packages come from the PostgreSQL apt repo)
sudo apt update
sudo apt install -y postgresql postgresql-contrib postgresql-16-pgvector redis-server
sudo systemctl enable --now postgresql redis-server
```

> On Fedora or Arch, use `dnf` or `pacman` to install the same packages.

### Alternative: run Postgres and Redis with Docker (both operating systems)

Use the `pgvector/pgvector` image so the extension is already installed:

```bash
docker run -d --name docuchat-db -e POSTGRES_USER=docuchat -e POSTGRES_PASSWORD=docuchat \
  -e POSTGRES_DB=docuchat -p 5432:5432 pgvector/pgvector:pg16
docker run -d --name docuchat-redis -p 6379:6379 redis:7
```

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url> docuchat
cd docuchat
npm install
```

### 2. Create the database

Skip this step if you're using the Docker command above.

The migrations run `CREATE EXTENSION vector`, which needs a superuser, and `prisma migrate dev` also creates a temporary shadow database. For local development, the simplest option is to make the `docuchat` user a superuser.

**Linux:**
```bash
sudo -u postgres psql -c "CREATE USER docuchat WITH PASSWORD 'docuchat' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE docuchat OWNER docuchat;"
```

**macOS:**
```bash
psql postgres -c "CREATE USER docuchat WITH PASSWORD 'docuchat' SUPERUSER;"
psql postgres -c "CREATE DATABASE docuchat OWNER docuchat;"
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`. These are the variables the code reads:

| Variable | Required | Default | Used for |
|----------|----------|---------|----------|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP port |
| `DATABASE_URL` | Yes | | Postgres connection string |
| `JWT_SECRET` | Yes | | Validated at startup (32+ characters) |
| `JWT_ACCESS_SECRET` | Yes | | Signs access tokens |
| `JWT_REFRESH_SECRET` | Yes | | Signs refresh tokens (must differ from the access secret) |
| `REDIS_HOST` | No | `localhost` | Redis for queues, cache, and rate limits |
| `REDIS_PORT` | No | `6379` | |
| `OPENAI_API_KEY` | For AI features | | Embeddings, chat, and agent |
| `FRONTEND_URL` | No | `http://localhost:3001` | CORS allowed origin |
| `WEBHOOK_SECRET` | For webhooks | | HMAC secret for `/webhooks` |

> `.env.example` doesn't yet include `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `REDIS_HOST`/`REDIS_PORT`, `FRONTEND_URL`, or `WEBHOOK_SECRET`, so add them by hand. `REDIS_URL` and `JWT_EXPIRES_IN` are validated but not currently read (access tokens expire after 15 minutes).

To generate a strong secret (run once per secret):
```bash
openssl rand -hex 32
```

The app validates the core variables at startup and exits with a clear error if any are missing or invalid.

### 4. Run migrations and seed the database

```bash
npx prisma migrate dev     # applies migrations and generates the Prisma client
npx prisma db seed         # seeds roles, permissions, and v1 chat/agent prompts
```

The seed step is required for chat: the AI gateway fails if there is no active prompt for a task type.

### 5. Start the API server and the worker

Run these in two terminals:

```bash
npm run dev          # API server
npm run dev:worker   # Document-processing worker
```

The server runs at `http://localhost:3000` and both processes restart automatically when you change a file. Documents stay `pending` until the worker is running.

- Health check: `http://localhost:3000/health` (also `/health/live` and `/health/ready`)
- API docs: `http://localhost:3000/api-docs`
- Queue dashboard: `http://localhost:3000/admin/queues`
- Prometheus metrics: `http://localhost:3000/metrics`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the API server with hot reload (tsx) |
| `npm run dev:worker` | Start the document worker with hot reload |
| `npm test` | Run the tests once (Vitest) |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run test:coverage` | Run the tests with a coverage report |
| `npx prisma studio` | Open a GUI to browse the database |

The RAG integration tests expect documents to be ingested already. Point them at your data with `TEST_USER_ID`, `TEST_OTHER_USER_ID`, and `TEST_DOCUMENT_ID`.

## API overview

All API routes are prefixed with `/api/v1`. Protected routes expect the header `Authorization: Bearer <accessToken>`.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/auth/register` | | Create an account |
| POST | `/auth/login` | | Log in and get access and refresh tokens |
| POST | `/auth/refresh` | | Exchange a refresh token for a new access token |
| POST | `/auth/logout` | | Revoke a refresh token |
| GET | `/documents` | `documents:read` | List your documents (`page`, `limit`, `status`, `search`, `sortBy`, `sortOrder`) |
| POST | `/documents` | `documents:create` | Create a document (`title`, `content`) and queue it for processing |
| GET | `/documents/:id` | | Get a document (supports ETags) |
| GET | `/documents/:id/processing-status` | `documents:read` | Status, error, and job progress |
| DELETE | `/documents/:id` | `documents:delete` | Soft-delete a document |
| GET | `/chat/conversations` | | List your conversations (supports ETags) |
| POST | `/chat/:id/messages` | `conversations:create` | Send a message and get a RAG answer with sources |
| GET | `/admin/roles` | `roles:manage` | List roles with permissions and user counts |
| POST | `/admin/users/:userId/roles` | `roles:manage` | Assign a role to a user |
| DELETE | `/admin/users/:userId/roles/:roleName` | `roles:manage` | Remove a role from a user |

Unversioned routes: `/health`, `/health/live`, `/health/ready`, `/metrics`, `/api-docs`, `/api-docs.json`, `/admin/queues`.

### Roles

| Role | Permissions |
|------|-------------|
| `admin` | All permissions |
| `member` | `documents:create/read/update`, `conversations:create/read` |
| `viewer` | `documents:read`, `conversations:read` |

## Status and known gaps

Built but not yet wired up, or still in progress:

- **Research agent route** (`POST /research` in `src/routes/agent.ts`) isn't mounted in `app.ts` yet.
- **Webhook route** (`src/routes/webhooks.ts`) isn't mounted. Webhook signature checking runs on `/webhooks` in `app.ts`, but before the raw body is captured.
- **No endpoint to create a conversation** yet. `createConversationSchema` exists, but no route uses it.
- **Fingerprint and abuse-detection middleware** aren't mounted.
- **Uploads take text in a JSON body** (`title`, `content`). The multi-format extractor is used by the worker, but there's no multipart file upload endpoint yet.
- **Validators expect UUIDs** for conversation and document IDs, but the Prisma models use `cuid()` IDs.
- **CI** (`.github/workflows/ci.yml`) still uses a SQLite `DATABASE_URL` and has no Postgres or Redis service, so it needs updating for pgvector.

## Troubleshooting

- **`Invalid environment variables`:** check `.env`. `JWT_SECRET` must be at least 32 characters.
- **`secretOrPrivateKey must have a value` on login:** set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env`.
- **`ECONNREFUSED 5432`:** PostgreSQL isn't running. Start it with `brew services start postgresql@16` on macOS or `sudo systemctl start postgresql` on Linux.
- **`ECONNREFUSED 6379`:** Redis isn't running. Start it with `brew services start redis` on macOS or `sudo systemctl start redis-server` on Linux.
- **`extension "vector" is not available`:** pgvector isn't installed for your Postgres version. Install it (see Prerequisites) or use the `pgvector/pgvector` Docker image.
- **`permission denied to create extension "vector"`:** the database user needs superuser rights to run the migration (see step 2).
- **`No active prompt for task type: chat`:** run `npx prisma db seed`.
- **`BUDGET_EXHAUSTED`:** the user has hit their monthly AI budget for their tier. In development, delete the Redis key `docuchat:budget:<userId>:<YYYY-MM>`.
- **Documents stuck in `pending`:** start the worker with `npm run dev:worker`, then check `/admin/queues`.
- **Prisma client errors after you change the schema:** run `npx prisma generate`.
- **Linux `peer authentication failed`:** connect over TCP with `localhost` in `DATABASE_URL`, not a Unix socket.

## License

ISC
