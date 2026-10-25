// Prisma 7 configuration (task T1.01).
//
// Prisma 7 moved datasource URLs out of prisma/schema.prisma into this config
// file (docs/DATABASE.md section 7). The migrate connection is supplied by the
// environment variable DATABASE_URL; it is used only when a command talks to a
// live database (`prisma migrate dev/deploy` against the Supabase project
// once it exists). Schema-only commands (validate, format, migrate diff)
// need no database.

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Required by `prisma migrate` and introspection commands: the schema engine
  // receives this URL as its --datasource argument even for schema-only diffs.
  // Without it the engine exits with a usage error that the CLI swallows, so
  // `migrate diff` prints nothing and exits 0 (observed on 7.10.1, Windows).
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      return new PrismaPg({ connectionString: process.env.DATABASE_URL });
    },
  },
});
