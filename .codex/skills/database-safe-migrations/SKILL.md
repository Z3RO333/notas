---
name: database-safe-migrations
description: Use when changing Supabase migrations, SQL functions, RPCs, views, indexes, backfills, or any data-counting logic that needs safe, source-of-truth-oriented database work.
---

# Database Safe Migrations

Use together with:
- [`../repo-context/SKILL.md`](../repo-context/SKILL.md)

Primary scope:
- `supabase/migrations/*`

Workflow:
1. Find the canonical object chain: table -> view -> RPC -> page/api consumer.
2. Prove the failure mode before patching:
   - duplicated rows
   - wrong timestamp
   - wrong filter
   - wrong source table
   - ambiguous function signature
3. Add a new migration with the next sequence number.
4. Keep migrations safe for lived environments.
5. If backfilling, make the target set explicit and bounded.

Non-negotiables:
- use `CREATE OR REPLACE VIEW`
- use `SET search_path = public` in `SECURITY DEFINER`
- do not replace business timestamps with convenience timestamps
- validate count semantics, not just syntax

Good validation targets:
- exact counts
- distinctness
- source-of-truth alignment
- compatibility with existing consumers
