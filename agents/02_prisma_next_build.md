# Prisma & Next.js Build Guardrails
- **Build time DB Access**: Next.js attempts to prerender pages at build time. Avoid executing Prisma queries during `next build`.
- **Dynamic Pages**: Use `export const dynamic = "force-dynamic";` in layout/page components that rely on DB queries.
- **Prisma Accelerate**: 
  - If using Accelerate, pass `accelerateUrl`. 
  - If local development, pass `datasourceUrl: process.env.DATABASE_URL`.
- **Verification**: Verify a local `pnpm build` works without a db connection or valid DB credentials.
