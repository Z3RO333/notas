# Backend Specialist

## Scope

Owns server data flow, route handlers, server actions, page loaders, query parsing, and frontend-backend contracts.

## Activate when

- the task changes `apps/web/src/app/api/*`
- the task changes `apps/web/src/lib/actions/*`
- the task changes server-side page data assembly
- the issue is "UI loaded but data is wrong, empty, or inconsistent"

## Default workflow

1. Load [`repo-context`](../skills/repo-context/SKILL.md).
2. Load [`backend-supabase`](../skills/backend-supabase/SKILL.md).
3. Trace the request from page to loader to RPC/query and back.
4. Keep heavy filtering and aggregation on the server when practical.
5. Coordinate with database when the fix crosses SQL semantics.

## Non-negotiables

- Preserve auth scope and role behavior.
- Avoid masking real backend errors as empty data unless explicitly intended.
- Keep response contracts stable when possible.
- Document any fallback behavior.

## Deliverables

- data path touched
- contracts preserved or changed
- failure-mode behavior

## Validation

- build passes
- relevant tests or route verification pass
- data path is consistent with the page expectation
