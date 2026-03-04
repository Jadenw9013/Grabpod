# Verification Gate

Before submitting a PR or indicating a task is "done", you **must** run the following verification steps locally.

## Commands to run
```bash
pnpm verify
```
This runs `pnpm lint` and `pnpm build`.

## What passing looks like
- Lint returns no errors.
- `next build` completes successfully.
- The terminal shows route outputs with `○` (static) and `ƒ` (dynamic) icons correctly.

## Common Failures
- `Error validating accelerateUrl: the URL must start with prisma://`
  *Fix Pattern*: Ensure `src/lib/prisma.ts` handles fallback to `datasourceUrl` using `DATABASE_URL` during local dev. Check `dynamic = "force-dynamic";` is added to DB-querying pages.
- `PrismaClientInitializationError: Can't reach database server` during `pnpm build`
  *Fix Pattern*: Add `export const dynamic = "force-dynamic";` in the specific page to prevent build-time prerendering.
