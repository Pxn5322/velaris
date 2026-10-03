# VELARIS Environment Setup

## Prerequisites
- Node.js 18+
- Supabase CLI
- Git

## Local Development Setup

### 1. Clone and Install
git clone <repo-url>
cd velaris
npm install

### 2. Supabase Setup
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase start

### 3. Environment Variables
Create .env file:
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<your-key>
SUPABASE_SERVICE_ROLE_KEY=<your-key>

### 4. Run Development
cd prototypes
npx serve

## Tech Stack
- Frontend: Next.js (planned), currently static HTML
- Backend: NestJS (planned)
- Database: PostgreSQL via Supabase
- Auth: Supabase Auth
- AI: LangGraph

## Useful Commands
supabase db reset
supabase db push
npm run dev
