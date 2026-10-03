# Database & Infrastructure

## Database
- **PostgreSQL** via **Supabase** - Open-source Firebase alternative
- Provides: PostgreSQL database, Authentication, Edge Functions, Real-time subscriptions, Storage
- Row Level Security (RLS) for multi-tenant data isolation
- PostgreSQL extensions: pgvector for embeddings

## Supabase Configuration

### Environment Variables
`
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
`

### Key Tables (to be defined)
- users, tenants, conversations, tickets, messages
- knowledge_sources, ai_agents, audit_logs

### Migration Strategy
- Supabase CLI for local development
- migrations/ folder for schema changes
- seed.sql for initial data
