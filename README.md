# DocuChat

DocuChat is a backend API for chatting with your documents. Users upload documents, the documents are processed in the background, and users can then hold conversations about them.

It's built with **Node.js, TypeScript, and Express 5**. It uses **PostgreSQL** (through Prisma) for storage and **Redis + BullMQ** for background jobs.

## Features

- **Authentication:** register, log in, log out, and refresh tokens, using JWT access tokens and stored refresh tokens. Passwords are hashed with bcrypt.
- **Role-based access control (RBAC):** roles (`admin`, `member`, `viewer`) are linked to fine-grained permissions such as `documents:create`.
- **Documents:** create, list, get, and soft-delete documents. Processing runs in a BullMQ queue and worker.
- **Conversations and messages:** each message records token usage and cost. *(in progress)*
- **Usage logging:** each user's actions, tokens, and cost are recorded.
- **Security and observability:** Helmet, CORS, Zod-validated config and requests, and structured logging with Pino.
- **API docs:** Swagger UI at `/api-docs`, with the raw spec at `/api-docs.json`.

## Project structure

```
src/
  server.ts        # Entry point (starts the HTTP server)
  app.ts           # Express app, middleware, and route mounting
  config/          # Swagger config
  controllers/     # Request handlers
  routes/          # Route definitions (auth, documents, chat, admin)
  services/        # Business logic (auth, rbac, documents, chat, embeddings)
  repositories/    # Database access through Prisma
  middleware/      # authenticate, authorize, validate, error-handler
  validators/      # Zod request schemas
  queues/          # BullMQ connection, queues, and workers
  events/          # Domain event listeners
  lib/             # config, prisma client, logger, tokens, errors
prisma/
  schema.prisma    # Database schema
  migrations/      # SQL migrations
  seed.ts          # Seed data (roles and permissions)
tests/             # Vitest tests
```

## Prerequisites (Linux and macOS)

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ (LTS recommended) | Install with [nvm](https://github.com/nvm-sh/nvm) |
| npm | Comes with Node | |
| PostgreSQL | 14+ | Required |
| Redis | 6+ | Required for background jobs |
| Git | Any | |

### Install on macOS (Homebrew)

```bash
# Homebrew (skip if already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

### Install on Linux (Ubuntu/Debian)

```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts

# PostgreSQL and Redis
sudo apt update
sudo apt install -y postgresql postgresql-contrib redis-server
sudo systemctl enable --now postgresql redis-server
```

> On Fedora or Arch, use `dnf` or `pacman` to install the same packages.

### Alternative: run Postgres and Redis with Docker (both operating systems)

```bash
docker run -d --name docuchat-db -e POSTGRES_USER=docuchat -e POSTGRES_PASSWORD=docuchat \
  -e POSTGRES_DB=docuchat -p 5432:5432 postgres:16
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

**Linux:**
```bash
sudo -u postgres psql -c "CREATE USER docuchat WITH PASSWORD 'docuchat' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE docuchat OWNER docuchat;"
```

**macOS:**
```bash
psql postgres -c "CREATE USER docuchat WITH PASSWORD 'docuchat' CREATEDB;"
psql postgres -c "CREATE DATABASE docuchat OWNER docuchat;"
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:

To generate a strong `JWT_SECRET`:
```bash
openssl rand -hex 32
```

The app validates these variables at startup and exits with a clear error if any are missing or invalid.

### 4. Run migrations and seed the database

```bash
npx prisma migrate dev     # applies migrations and generates the Prisma client
npx prisma db seed         # seeds roles and permissions
```

### 5. Start the dev server

```bash
npm run dev
```

The server runs at `http://localhost:3000` and restarts automatically when you change a file.

- Health check: `http://localhost:3000/health`
- API docs: `http://localhost:3000/api-docs`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server with hot reload (tsx) |
| `npm test` | Run the tests once (Vitest) |
| `npm run test:watch` | Run the tests in watch mode |
| `npm run test:coverage` | Run the tests with a coverage report |
| `npx prisma studio` | Open a GUI to browse the database |

## API overview

All routes are prefixed with `/api/v1`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create an account |
| POST | `/auth/login` | Log in and get access and refresh tokens |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token |
| POST | `/auth/logout` | Revoke a refresh token |
| GET | `/documents` | List your documents |
| POST | `/documents` | Upload or create a document |
| GET | `/documents/:id` | Get a document |
| DELETE | `/documents/:id` | Soft-delete a document |
| GET | `/admin/roles` | List roles (admin) |
| POST | `/admin/users/:userId/roles` | Assign a role to a user (admin) |
| DELETE | `/admin/users/:userId/roles/:roleName` | Remove a role from a user (admin) |

Protected routes expect the header `Authorization: Bearer <accessToken>`.

## Troubleshooting

- **`Invalid environment variables`:** check `.env`. `JWT_SECRET` must be at least 32 characters.
- **`ECONNREFUSED 5432`:** PostgreSQL isn't running. Start it with `brew services start postgresql@16` on macOS or `sudo systemctl start postgresql` on Linux.
- **`ECONNREFUSED 6379`:** Redis isn't running. Start it with `brew services start redis` on macOS or `sudo systemctl start redis-server` on Linux.
- **Prisma client errors after you change the schema:** run `npx prisma generate`.
- **Linux `peer authentication failed`:** connect over TCP with `localhost` in `DATABASE_URL` (as shown above), not a Unix socket.

## License

ISC
