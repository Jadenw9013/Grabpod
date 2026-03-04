# Grabpod SaaS — Operational Wireframe Specification (v2)

**File purpose:** This is the single source of truth for the Grabpod grayscale wireframe UI/UX.  
It merges the original wireframe requirements **plus** the operational scope updates (terminology, warehouse inventory, scheduling-based restock, profitability page, contract fields).  

**Audience:** Engineers implementing the UI so it matches the existing Figma Make wireframe.  
**Strict rule:** If a detail is not specified here, do **not** guess. Leave a clear `TODO:` comment or a placeholder.

---

## 0) Summary of What Exists / Must Be Implemented

### Core features to implement (required)
- Multi-page navigation using **React Router**
- Left sidebar navigation with **all menu items** (ordered exactly; see Section 2)
- Bottom-of-sidebar **user profile section** and **organization switcher**
- Detailed screens:
  - Dashboard Overview
  - Machine Detail
  - Product Rankings
  - Contracts
  - Restock Queue (scheduling model)
  - Inventory (Warehouse)
  - Profitability
- Placeholder pages:
  - Machines
  - Locations
  - Reports
  - Settings
- Grayscale wireframe aesthetic (minimal styling; layout + hierarchy)
- Data tables with mock data
- Charts via **Recharts**
- Metric cards with trends and alerts
- Stock level visualizations (progress bars)
- Priority/urgency indicators:
  - **Red ONLY** for the `LOW` badge

### Design approach (required)
- Grayscale wireframe aesthetic with clear hierarchy
- Modern B2B SaaS layout similar to Stripe/Linear/Notion/admin dashboards
- Focus on actionable data:
  - low stock alerts
  - revenue at risk
  - scheduling and restock prioritization
- Responsive grid layouts and readable tables
- Clean spacing, minimal styling (function > form)
- Must scale visually to **50+ machines** and multiple locations

---

## 1) Global Layout (Non-Negotiable)

### Overall page structure
All pages must follow the same structural pattern:

1. **Left vertical sidebar** (fixed navigation)
2. **Top header bar** (within main area)
3. **Main content area** (scrollable)

### Layout rules
- Do **not** redesign the global layout.
- Use a consistent grid system across pages (e.g., 12-col or flexible CSS grid).
- Use consistent typography scale across all pages.
- Use consistent card styling for metric sections.
- Use consistent table styling and spacing for data density.

### Responsive behavior
- Sidebar remains left and stable on desktop.
- Main content stacks appropriately on smaller widths.
- Tables should allow horizontal scrolling on small screens (do not remove columns).

---

## 2) Sidebar Navigation (Order Must Match Exactly)

### Primary navigation items (in this exact order)
1. Dashboard  
2. Machines  
3. Inventory  
4. Rankings  
5. Profitability  
6. Contracts  
7. Locations  
8. Restock Queue  
9. Reports  
10. Settings  

### Bottom sidebar section (must exist)
- **Organization switcher** (e.g., dropdown/select)
- **User profile** block (name + role)

**Do not change navigation order, labels, or overall sidebar structure.**

---

## 3) Global Terminology Rules (Apply Everywhere)

### Machine-level inventory term
- Replace any machine-level “On Hand” label with: **Stock Remain**

### Warehouse-level inventory term
- Introduce new term: **Stock On Hand** = Warehouse inventory

### LOW badge tooltip (must be consistent everywhere)
When a `LOW` badge appears, it must have a tooltip:

> **LOW = Not enough inventory to cover next restock window based on sales velocity**

### Color rules
- **Grayscale only** for the UI
- **Red only** for the `LOW` badge/tag
- No other accent colors permitted

---

## 4) User Roles & Permissions

### Roles
- **Admin**
- **Manager**
- **Stocker**

### Visibility rules
- Admin: full visibility
- Manager: operational + analytics access
- Stocker: sees only:
  - **Restock Queue**
  - **Machine Inventory pages** (Machine Detail)

### Edit permissions (must be reflected in the UI)
- Admin/Manager:
  - Can edit **Capacity**
  - Can edit **Stock Remain**
- Stocker:
  - Cannot edit financial fields
  - Cannot edit contracts
  - No editing on machine inventory fields

### UI cues
- Editable fields show a subtle edit affordance (pencil icon).
- Non-editable states show no edit icon (or disabled styling if needed).
- Do not redesign layout to implement permissions; use subtle indicators.

---

## 5) Screen Spec: Dashboard Overview

**Purpose:** Owner’s “morning command center” view.

### 5.1 Top Section — Metric Cards (6 cards)
Must display these exact cards:
- Total Revenue (Today)
- Net Revenue (Today)
- Machines Needing Attention
- Low Stock Alerts
- Active Locations
- This Month Revenue

Each card includes:
- Title
- Primary number/value
- Optional trend indicator (e.g., `+12.5%`)
- Optional subtext

**Styling:** grayscale cards; no branding.

---

### 5.2 Revenue Chart Section (Recharts)
Chart title must be exactly:

**This Month vs Previous Month**

Chart type:
- Two-line comparison:
  - **This Month** (solid)
  - **Previous Month** (dashed)

Add:
- Legend in the **top-right** of the chart container
- Do not redesign chart container

---

### 5.3 New Sections (Below Revenue Chart)
Add two sections below the revenue chart:

1) **Top 5 Beverages**  
2) **Top 5 Snacks**

Display style:
- Ranked list (1–5)
- Product name
- Horizontal bar indicator
- Value (units or revenue)

Minimal styling; grayscale only.

---

### 5.4 Machines Below 50% Stock Table
Table shows machines under 50% stock with actionable context.

Columns (must include):
- Machine Name
- Location
- Stock %
- Revenue at Risk
- Status

Updated requirements:
- Keep Stock % column
- Add:
  - `LOW` velocity-based badge (if applicable)
  - **Suggested Units** column
  - Drilldown icon (opens machine restock detail or machine detail)

---

### 5.5 Restock Priority List (Top 5 Urgent Machines)
This is a prioritized list (separate from “below 50%” table).

Columns:
- Machine
- Location
- Stock %
- Revenue at Risk
- Suggested Units
- Priority Score

Rules:
- Show `LOW` badge when velocity-based logic triggers
- Keep this section highly actionable and data-dense

---

## 6) Screen Spec: Machine Detail Page

**Purpose:** Deep dive for a single machine.

### 6.1 Header
Header must include:
- Machine Name
- Location
- Status (Online / Offline)
- Last Sync Time

---

### 6.2 Current Inventory (Per Machine)
Add top-line metric above the table:
- **Total Products Offered** (e.g., `18 products`)

Inventory table columns (must include):
- Product
- Category
- Capacity
- Stock Remain
- % Remaining (progress bar)
- Days of Cover
- Below Threshold indicator

Rules:
- Rename “On Hand” → **Stock Remain**
- Add `Days of Cover`
- Add `LOW` badge if `days_of_cover < threshold`
  - `LOW` badge is subtle red tag
  - Must have the global tooltip text (see Section 3)
- Add row-level drilldown affordance (chevron/icon or clickable row)
- Editing affordances:
  - Capacity: pencil icon for Admin/Manager
  - Stock Remain: pencil icon for Admin/Manager
  - Stocker: no edit icons

**Do not change the overall table layout drastically.**

---

### 6.3 Sales Summary
Include metric cards or compact blocks:
- Revenue Today
- Revenue This Month
- Top 3 products for this machine

---

### 6.4 Sales History Chart (Recharts)
Two-line comparison:
- This Month (solid)
- Previous Month (dashed)

Legend top-right.  
Do not redesign container.

---

### 6.5 Restock History Table
Columns:
- Date
- Products Restocked
- Total Units
- Performed By

Grayscale table styling.

---

## 7) Screen Spec: Product Rankings Page

**Purpose:** Analyze product performance across machines/locations.

### 7.1 Top filters
Must include these filters:
- Date Range
- Location filter
- Machine filter
- Cluster area filter
- Category filter

---

### 7.2 Section 1 — Top 10 Products (by quantity sold)
Columns:
- Rank
- Product Name
- Category
- Units Sold
- Revenue
- Locations Active

---

### 7.3 Section 2 — Lowest 10 Performing Products
Same structure as top 10.

---

### 7.4 Section 3 — Performance by Location
Use either:
- Table layout, or
- Heatmap-style table (still grayscale)

No extra colors beyond grayscale.

---

## 8) Screen Spec: Inventory (Warehouse)

**Purpose:** Warehouse inventory management (not machine stock).

### 8.1 Top metric cards
Include:
- Total Warehouse Units
- Total SKUs
- Low Warehouse Items (optional)

---

### 8.2 Warehouse inventory table
Columns:
- Product Name
- Apex SKU
- Category
- Stock On Hand
- Last Updated

Rules:
- This page uses **Stock On Hand** only (warehouse)
- Do not use “Stock Remain” anywhere on this page unless explicitly describing machine inventory (avoid mixing concepts)

---

## 9) Screen Spec: Restock Queue (Scheduling Model)

**Purpose:** Operational scheduling view (not status-centric).

### 9.1 Table columns (must match exactly)
- Machine
- Assigned Date
- Priority
- Products Count
- Estimated Duration
- Actions

### 9.2 Scheduling rules
- If `Assigned Date` is **NULL**:
  - Show tag: **Unscheduled**
- If assigned:
  - Show date format `MM/DD/YYYY`

### 9.3 Top action
- Include **Generate Route** button at top

Styling:
- grayscale
- minimal UI
- red only for LOW badge (if used here)

---

## 10) Screen Spec: Contracts

**Purpose:** Profit sharing & financial rules by location/vendor.

### 10.1 List view table
Columns:
- Location
- Profit Share Below $1000
- Profit Share Above $1000
- Inception Date
- Rental Start Date
- Machines Bound

### 10.2 Detail view
Must include:
- Revenue breakdown
- Net revenue calculation preview
- Editable fields:
  - Sales Tax Rate
  - Credit Card Fee Rate
  - Effective From Date

Show note:
> Rates vary by location and vendor

---

## 11) Screen Spec: Profitability

**Purpose:** Profit and margin analysis by product.

### 11.1 Month filter
Dropdown options:
- This Month
- Previous Month

### 11.2 Main table
Columns:
- Product
- Revenue
- Cost
- Margin
- Quantity Sold

Include a top section:
- “Top products by revenue” (summary block or leading table emphasis)

Keep layout consistent with other analytics pages (Rankings).

---

## 12) Placeholder Pages (Must Exist)

These pages must exist as routes with placeholder content (simple title + “Coming soon”):

- Machines
- Locations
- Reports
- Settings

Do not invent features on these pages.

---

## 13) Visual Rules (Strict)

- Grayscale only
- Red only for `LOW` badge
- No decorative UI, gradients, or branding colors
- No animations
- Data density prioritized
- Clear spacing and hierarchy
- Use cards for metric sections
- Use simple bar indicators for stock %
- Professional B2B SaaS tone
- No marketing copy

---

## 14) Interaction Expectations

Allowed interactions (wireframe-level):
- Sidebar navigation changes routes
- Drilldown icons navigate to detail views
- Tooltip on `LOW` badge
- Editable fields show pencil icon (Admin/Manager only)
- Tables may be sortable (optional)

If backend data is not available:
- Use mock data
- Keep structure accurate
- Do not fabricate new fields not defined here

---

## 15) Engineering Guardrails (No Hallucinations)

### Do NOT
- Redesign entire layout
- Change sidebar navigation or ordering
- Add branding or new color schemes
- Add animations
- Simplify or remove table columns
- Invent new features not listed here
- “Modernize” styling beyond grayscale wireframe

### If something is missing/unclear
- Leave a `TODO:` comment
- Add a placeholder UI element without assuming data logic

---

## 16) End Goal

The wireframe must:
- Make morning priorities obvious
- Prioritize actionable data (low stock, revenue risk, machine issues)
- Separate warehouse vs machine inventory clearly
- Support scheduling-based restock operations
- Scale to 50+ machines and multi-location businesses
- Look professional and investor-ready even in low-fidelity wireframe form
