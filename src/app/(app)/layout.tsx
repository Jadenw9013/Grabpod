"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Monitor,
  Package,
  BarChart3,
  TrendingUp,
  FileText,
  MapPin,
  RefreshCw,
  ClipboardList,
  Settings,
  ChevronDown,
  ChevronRight,
  Upload,
  PackagePlus,
  RotateCcw,
  ListChecks,
  User,
} from "lucide-react";

/* ─── Primary nav (exact order from wireframe §2) ─── */
const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/machines", label: "Machines", icon: Monitor },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/rankings", label: "Rankings", icon: BarChart3 },
  { href: "/profitability", label: "Profitability", icon: TrendingUp },
  { href: "/contracts", label: "Contracts", icon: FileText },
  { href: "/locations", label: "Locations", icon: MapPin },
  { href: "/restock-queue", label: "Restock Queue", icon: RefreshCw },
  { href: "/reports", label: "Reports", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/* ─── Admin tools: existing pages that aren't in the wireframe primary nav ─── */
const ADMIN_NAV = [
  { href: "/imports", label: "Order Import", icon: Upload },
  { href: "/product-import", label: "Product Import", icon: PackagePlus },
  { href: "/sync", label: "Sync", icon: RotateCcw },
  { href: "/restock-sessions", label: "Restock Sessions", icon: ListChecks },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar (fixed left) ── */}
      <aside className="w-56 shrink-0 border-r bg-muted/40 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Grabpod
          </Link>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 flex flex-col gap-0.5 px-2 py-2 overflow-y-auto">
          {PRIMARY_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${isActive(href)
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}

          {/* ── Admin Tools (collapsible) ── */}
          <div className="mt-3 pt-3 border-t">
            <button
              onClick={() => setAdminOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {adminOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Admin Tools
            </button>
            {adminOpen &&
              ADMIN_NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${isActive(href)
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              ))}
          </div>
        </nav>

        {/* ── Bottom sidebar: Org switcher + User profile ── */}
        <div className="border-t p-3 space-y-3">
          {/* Organization switcher */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Organization
            </label>
            {/* TODO: Wire to real tenant list */}
            <select className="w-full rounded border bg-background px-2 py-1.5 text-sm">
              <option>My Organization</option>
            </select>
          </div>

          {/* User profile block */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <User className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              {/* TODO: Wire to real user data */}
              <div className="text-sm font-medium">Admin User</div>
              <div className="text-[11px] text-muted-foreground">Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <div className="text-sm text-muted-foreground">
            {/* Simple breadcrumb from pathname */}
            {pathname
              .split("/")
              .filter(Boolean)
              .map((seg, i, arr) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1">/</span>}
                  <span className={i === arr.length - 1 ? "text-foreground font-medium" : ""}>
                    {seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ")}
                  </span>
                </span>
              ))}
          </div>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
