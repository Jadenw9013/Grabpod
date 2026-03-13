# Grabpod MVP

Grabpod is a multi-tenant Next.js application that provides analytics, synchronization, and dashboard management for smart vending machine operators. It integrates directly with vending API vendors (e.g. Haha) to ingest order data, compute key performance indicators (KPIs), and present live dashboard analytics.

## Tech Stack

*   **Framework:** Next.js (App Router, Server Components)
*   **Database ORM:** Prisma
*   **Database:** PostgreSQL
*   **Styling:** Tailwind CSS + shadcn/ui
*   **Package Manager:** pnpm
*   **Background Jobs:** Inngest (Production polling engine)

## Prerequisites

Before setting up the project locally, ensure you have:
*   [Node.js](https://nodejs.org/) (v18+)
*   [pnpm](https://pnpm.io/) (v8+)
*   A running instance of PostgreSQL (v14+)

## Getting Started Locally

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure your environment:**
   Create a `.env` file in the root based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
   *Make sure you provide valid database credentials (`DATABASE_URL`), API Vendor tokens, and the base app URL (`NEXT_PUBLIC_APP_URL`).*

3. **Initialize the Database:**
   Push the schema to your local database and run the seeds to prepopulate the Dev tenant:
   ```bash
   pnpm dlx prisma db push
   pnpm run db
   ```

4. **Run the development server:**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

## Vercel Deployment

Grabpod is designed to be easily deployed on Vercel. Follow these steps to ensure a smooth production rollout.

1.  **Link your GitHub Repository** to a new Vercel Project.
2.  **Configure Environment Variables** in the Vercel dashboard:
    *   `DATABASE_URL`
    *   `HAHA_HOST`, `HAHA_APPKEY`, `HAHA_APPSECRET`
    *   `NEXT_PUBLIC_APP_URL`
3.  **Build Settings:** Vercel automatically detects Next.js. The default build command (`next build`) and install command (`pnpm install`) will be used.
4.  **Database Migration:** You must manually apply production migrations via Prisma or utilize a deployment script.
5.  **Inngest Deployment:** If you are using the background jobs/polling engine, make sure the `/api/inngest` endpoint is properly exposed and synced with your Inngest project dashboard.

## Verification & Testing

To run the internal verification scripts (linting and build steps) before a commit:
```bash
pnpm run verify
```
