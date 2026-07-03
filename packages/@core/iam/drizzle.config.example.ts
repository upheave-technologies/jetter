// =============================================================================
// Example Drizzle Kit Configuration for Consuming Applications
// =============================================================================
// Copy this to your project root as drizzle.config.ts and adjust paths.
//
// Each Nucleus module exports its schema as TypeScript code. The consuming
// application composes all module schemas into a single drizzle-kit config
// for migration generation.
//
// Usage:
//   npx drizzle-kit generate   -- generate SQL migration files
//   npx drizzle-kit migrate    -- apply migrations to the database
//   npx drizzle-kit push       -- push schema directly (development only)
//   npx drizzle-kit studio     -- open Drizzle Studio GUI
// =============================================================================

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './packages/@core/iam/schema/index.ts',
    './packages/@core/auth/schema/index.ts',
    // Add other module schemas here as they are created:
    // './packages/@core/identity/schema/index.ts',
    // './packages/@core/tenancy/schema/index.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
