---
name: backend-supabase
description: Use when changing server components, route handlers, server actions, Supabase data assembly, or frontend-backend contracts in this repository.
---

# Backend Supabase

Use together with:
- [`../repo-context/SKILL.md`](../repo-context/SKILL.md)

Primary scope:
- `apps/web/src/app/api/*`
- `apps/web/src/lib/actions/*`
- server-side page loaders and data orchestration

Workflow:
1. Trace page or action input.
2. Trace the server layer that shapes the data.
3. Trace the downstream RPC, view, or query.
4. Fix the narrowest broken contract first.
5. Keep expensive filtering and aggregation on the server or database when feasible.

Guardrails:
- do not silently turn errors into empty data unless the product wants that behavior
- preserve role scope for admin and gestor
- document fallbacks and compatibility bridges
- coordinate with the database specialist when SQL semantics are involved
