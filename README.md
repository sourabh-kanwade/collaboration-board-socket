# Collaboration Board Socket Server

A real-time WebSocket backend for a collaborative whiteboard application, powered by Node.js, Socket.IO, and Prisma.

## Features

- **Real-Time Board Sync:** Synchronizes whiteboard elements across all connected clients in real-time.
- **Live Cursors:** Broadcasts cursor positions of all participants.
- **Presence & Room Management:** Tracks connected users, displaying active participants with randomized colors.
- **Database Persistence:** Automatically persists the state of the whiteboard to a PostgreSQL database using Prisma ORM.
- **Authorization:** Ensures that clients have proper ownership or membership before mutating board states.

## Tech Stack

- **Runtime:** [Node.js](https://nodejs.org/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **WebSockets:** [Socket.IO](https://socket.io/)
- **Database ORM:** [Prisma](https://www.prisma.io/)
- **Database:** PostgreSQL
- **Package Manager:** [pnpm](https://pnpm.io/)
- **Logging:** [loglevel](https://github.com/pimterry/loglevel)

## Prerequisites

- Node.js (v18+ recommended)
- [pnpm](https://pnpm.io/installation) installed (`npm install -g pnpm` or via Corepack)
- PostgreSQL database

## Getting Started

### 1. Install Dependencies

Clone the repository and install dependencies using pnpm:

```bash
pnpm install
```

### 2. Environment Variables

Create a `.env` file in the root directory (you can use `.env.example` if available) and configure your environment variables:

```env
# Database connection string for Prisma
DATABASE_URL="postgres://username:password@localhost:5432/collab-board"

# Socket server configuration
SOCKET_PORT=3001
SOCKET_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3002"
```

### 3. Database Setup

Run Prisma migrations to set up your database schema:

```bash
pnpm exec prisma db push
# or
pnpm exec prisma migrate dev
```

Generate the Prisma client:

```bash
pnpm exec prisma generate
```

## Running the Application

### Development

Run the server in development mode with hot-reloading using `tsx`:

```bash
pnpm run dev
```

### Production

Build the TypeScript source code and run the compiled output:

```bash
# Build the project (includes typechecking)
pnpm run build

# Start the production server
pnpm start
```

_Note: In production (`NODE_ENV="production"`), verbose logging is automatically disabled to keep logs clean._

## Available Scripts

- `pnpm run dev`: Starts the development server using `tsx watch`.
- `pnpm run build`: Typechecks and compiles TypeScript into the `dist/` directory.
- `pnpm start`: Runs the built server from `dist/server.js`.
- `pnpm run typecheck`: Runs TypeScript compiler check without emitting files.
- `pnpm run lint`: Lints the codebase using ESLint.
- `pnpm run test`: Lints, typechecks, and runs the test suite.

## License

ISC
