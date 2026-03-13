# Vantalos Recruiter Backend

Production-grade backend built with Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Redis, and BullMQ.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Fastify
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Cache/Queue**: Redis + BullMQ
- **Package Manager**: pnpm
- **Testing**: Vitest
- **Logging**: Pino

## Prerequisites

- Node.js 20 or higher
- pnpm installed globally (`npm install -g pnpm`)
- Docker and Docker Compose (for local development with databases)

## Getting Started

### 1. Clone and Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and provide:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `TWILIO_AUTH_TOKEN`: Your Twilio auth token
- `TWILIO_ACCOUNT_SID`: Your Twilio account SID
- `TWILIO_WHATSAPP_NUMBER`: Your Twilio WhatsApp number
- `OPENAI_API_KEY`: Your OpenAI API key

### 3. Start Docker Services (PostgreSQL & Redis)

For development:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

This will start:
- PostgreSQL on port `5432`
- Redis on port `6379`

### 4. Set Up Database

Generate Prisma Client:

```bash
pnpm prisma:generate
```

Run migrations (when you add models):

```bash
pnpm prisma:migrate
```

### 5. Run the Application

Development mode (with hot reload):

```bash
pnpm dev
```

Production mode:

```bash
pnpm build
pnpm start
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` env var).

## Available Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build TypeScript to JavaScript
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Run ESLint with auto-fix
- `pnpm format` - Format code with Prettier
- `pnpm test` - Run tests with Vitest
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm prisma:generate` - Generate Prisma Client
- `pnpm prisma:migrate` - Run Prisma migrations (dev)
- `pnpm prisma:studio` - Open Prisma Studio
- `pnpm prisma:deploy` - Deploy Prisma migrations (production)

## API Endpoints

### Health Check

```bash
GET /health
```

Returns:
```json
{
  "ok": true,
  "service": "vantalos-recruiter"
}
```

## Docker

### Development

Start only database services:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

Stop services:

```bash
docker-compose -f docker-compose.dev.yml down
```

### Production

Build and run the full stack:

```bash
docker-compose --profile production up -d
```

## Project Structure

```
.
├── src/
│   ├── config/
│   │   └── env.ts          # Environment variable validation
│   ├── db/
│   │   └── prisma.ts       # Prisma client wrapper
│   ├── queues/
│   │   └── queue.ts        # BullMQ queue setup
│   ├── routes/
│   │   ├── health.ts       # Health check route
│   │   └── health.test.ts  # Health check tests
│   ├── workers/
│   │   └── index.ts       # Worker placeholders
│   └── index.ts            # Application entry point
├── prisma/
│   └── schema.prisma       # Prisma schema (placeholder)
├── docker-compose.yml      # Production Docker Compose
├── docker-compose.dev.yml  # Development Docker Compose
├── Dockerfile              # Application Docker image
└── README.md
```

## Development

The project uses:

- **ESLint** for code linting
- **Prettier** for code formatting
- **TypeScript** with strict mode enabled
- **Vitest** for testing

Make sure your editor is configured to use these tools.

## Environment Variables

All environment variables are validated using Zod. See `src/config/env.ts` for the schema.

Required variables:
- `DATABASE_URL`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_WHATSAPP_NUMBER`
- `OPENAI_API_KEY`

Optional variables:
- `PORT` (default: 3000)
- `NODE_ENV` (default: development)
- `REDIS_URL` (default: redis://localhost:6379)

## License

ISC

