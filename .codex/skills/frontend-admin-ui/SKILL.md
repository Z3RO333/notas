---
name: frontend-admin-ui
description: Use when changing admin pages, filters, tables, charts, cards, spacing, copy, or interaction design in the Next.js frontend, especially when dark mode and responsive states must remain solid.
---

# Frontend Admin UI

Use together with:
- [`../repo-context/SKILL.md`](../repo-context/SKILL.md)

Primary scope:
- `apps/web/src/app/admin/*`
- `apps/web/src/components/*`

Workflow:
1. Inspect the page entry and the shared components it depends on.
2. Simplify hierarchy before adding new UI.
3. Favor scanability, spacing, and shorter copy over extra framing.
4. Preserve actions, KPIs, filters, and data density where they matter operationally.

Always check:
- dark mode
- responsive layout
- loading, empty, and error states
- filter ergonomics

Prefer:
- shared primitives over one-off components
- compact explanatory copy
- collapsible secondary context when a page is visually dense
