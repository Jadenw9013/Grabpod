import Link from "next/link";

export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Grabpod</h1>
      <p className="text-sm text-muted-foreground mt-2">Vending ops MVP</p>
      <div className="mt-6 flex gap-4">
        <Link className="underline" href="/dashboard">Dashboard</Link>
        <Link className="underline" href="/machines">Machines</Link>
        <Link className="underline" href="/rankings">Rankings</Link>
        <Link className="underline" href="/restock-queue">Restock Queue</Link>
      </div>
    </main>
  );
}
