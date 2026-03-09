# Active Context: Next.js Starter Template

## Current State

**Template Status**: ✅ Ready for development

The template is a clean Next.js 16 starter with TypeScript and Tailwind CSS 4. It's ready for AI-assisted expansion to build any type of application.

## Recently Completed

- [x] Update .env.production with correct Supabase project ID `jmrgooqidunwswiqhkie`
- [x] Add Supabase URL and anon key to env.ts
- [x] Create .env.local for local development
- [x] Updated .env.production with clearer Vercel setup instructions

## Current Issues

**Error**: `getaddrinfo ENOTFOUND db.jmrgooqidunwswiqhkie.supabase.co`

**Possible causes**:
1. Supabase project is paused (free tier gets paused after inactivity)
2. DATABASE_URL not set in Vercel Environment Variables
3. DATABASE_URL still contains placeholder `[YOUR-PASSWORD]` instead of actual password

**Required action**: User needs to check:
- Go to Supabase Dashboard → Your Project → check if project is "Active" (not paused)
- Set DATABASE_URL in Vercel with actual password (not placeholder)
- Redeploy after setting variables

## Current Structure

| File/Directory | Purpose | Status |
|----------------|---------|--------|
| `src/lib/db.ts` | Database layer (raw SQL) | ✅ Ready |
| `src/app/page.tsx` | Home page | ✅ Ready |
| `src/app/layout.tsx` | Root layout | ✅ Ready |
| `src/app/globals.css` | Global styles | ✅ Ready |
| `.kilocode/` | AI context & recipes | ✅ Ready |

## Database Architecture

### Vercel Deployment Support

The app now uses raw SQL queries instead of Drizzle ORM, enabling deployment to:
- **Vercel Postgres** - Set `POSTGRES_URL` environment variable
- **Turso DB** - Works with raw SQL (no ORM needed)
- **Local development** - Uses SQLite

### How It Works

1. On Vercel: Detects `POSTGRES_URL` env var → Uses `pg` library (not @vercel/postgres)
2. Local: Falls back to `better-sqlite3`

All API routes use the unified `dbQuery()`, `dbGet()`, `dbInsert()`, `dbExecute()` functions.

## Quick Start Guide

### To add a new page:

Create a file at `src/app/[route]/page.tsx`:
```tsx
export default function NewPage() {
  return <div>New page content</div>;
}
```

### To add components:

Create `src/components/` directory and add components:
```tsx
// src/components/ui/Button.tsx
export function Button({ children }: { children: React.ReactNode }) {
  return <button className="px-4 py-2 bg-blue-600 text-white rounded">{children}</button>;
}
```

### To add API routes:

Create `src/app/api/[route]/route.ts`:
```tsx
import { dbQuery, dbGet, dbInsert, initializeDatabase } from "@/lib/db";

initializeDatabase();

export async function GET() {
  const users = await dbQuery("SELECT * FROM users");
  return NextResponse.json({ users });
}
```

### Database Setup

On Vercel:
1. Go to Vercel Dashboard → Storage → Create Database → Postgres
2. The `POSTGRES_URL` is auto-set as environment variable
3. Tables are created automatically on first deploy

## Available Recipes

| Recipe | File | Use Case |
|--------|------|----------|
| Add Database | `.kilocode/recipes/add-database.md` | Data persistence with raw SQL |

## Pending Improvements

- [ ] Add more recipes (auth, email, etc.)
- [ ] Add example components
- [ ] Add testing setup recipe

## Session History

| Date | Changes |
|------|---------|
| Initial | Template created with base setup |
| 2024-03 | Built complete MatatuConnect Kenya transport system |
| 2024-03 | Migrated database from SQLite to Vercel Postgres to Supabase (multiple attempts) |
| 2024-03 | Complete rewrite: Replaced Drizzle ORM with raw SQL queries for Vercel compatibility |
| 2024-03 | Fixed registration: Switched from @vercel/postgres to pg library for proper parameterized queries |
| 2024-03 | Created .env file with environment variables for local development (SQLite) |
| 2024-03 | Created env.ts loader with Vercel/SQLite auto-detection and JWT secret generation |
