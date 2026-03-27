---
name: security-review
description: Use when reviewing authentication, authorization, RLS, service-role access, exports, imports, uploads, secrets, or sensitive data exposure in this repository.
---

# Security Review

Use together with:
- [`../repo-context/SKILL.md`](../repo-context/SKILL.md)

Review these questions:

1. Who can trigger this path?
2. What data can it read or mutate?
3. Is enforcement server-side or only client-side?
4. Does it use anon, SSR, or service-role Supabase access?
5. Could it expose more data than intended through exports, logs, or errors?
6. Does it change role scope for admin versus gestor?

High-risk areas in this repo:
- `apps/web/src/lib/supabase/admin.ts`
- `apps/web/src/app/api/*`
- export/import endpoints
- migrations that change `SECURITY DEFINER`, RLS, or canonical views

Expected output:
- risk summary
- mitigation list
- safe-to-ship or blocked judgment
