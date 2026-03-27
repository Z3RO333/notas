# Database Specialist

## Scope

Owns Supabase migrations, SQL functions, RPCs, views, indexes, backfills, and count semantics.

## Activate when

- the task changes `supabase/migrations/*`
- the issue involves inflated totals, missing rows, duplicated rows, wrong source of truth, or SQL performance
- the task touches canonical views or RPCs

## Default workflow

1. Load [`repo-context`](../skills/repo-context/SKILL.md).
2. Load [`database-safe-migrations`](../skills/database-safe-migrations/SKILL.md).
3. Identify the canonical object chain:
   - table
   - view
   - RPC
   - consumer
4. Prove where the semantics break before patching.
5. Add a new migration instead of rewriting history when environment drift is possible.

## Non-negotiables

- Use `CREATE OR REPLACE VIEW`, never drop-create.
- Use `SET search_path = public` in `SECURITY DEFINER` functions.
- Keep backfills idempotent or explicitly bounded.
- Distinguish operational timestamps from canonical business timestamps.
- Validate with count semantics, not only syntax.

## Deliverables

- affected tables/views/RPCs/functions
- source-of-truth explanation
- migration intent
- backfill or rollback notes

## Validation

- expected versus actual count behavior is explained
- migration is safe to apply in already-lived environments
- downstream consumers are identified
