# Agent Operating Model

This repository uses a lead-agent model with domain specialists.

Default lead:
- [`principal-orchestrator.md`](./.codex/agents/principal-orchestrator.md)

Domain specialists:
- [`frontend-specialist.md`](./.codex/agents/frontend-specialist.md)
- [`backend-specialist.md`](./.codex/agents/backend-specialist.md)
- [`database-specialist.md`](./.codex/agents/database-specialist.md)
- [`devops-specialist.md`](./.codex/agents/devops-specialist.md)
- [`security-specialist.md`](./.codex/agents/security-specialist.md)

Reusable local skills:
- [`repo-context`](./.codex/skills/repo-context/SKILL.md)
- [`frontend-admin-ui`](./.codex/skills/frontend-admin-ui/SKILL.md)
- [`backend-supabase`](./.codex/skills/backend-supabase/SKILL.md)
- [`database-safe-migrations`](./.codex/skills/database-safe-migrations/SKILL.md)
- [`devops-verification`](./.codex/skills/devops-verification/SKILL.md)
- [`security-review`](./.codex/skills/security-review/SKILL.md)

## Default behavior

The principal orchestrator owns every request by default.

It must:
- classify the request by domain
- assign one primary owner
- pull in supporting specialists only when the change crosses domain boundaries
- keep one shared acceptance checklist
- consolidate validation, risk, and final outcome

## Routing rules

Use the frontend specialist when:
- the task changes pages, layouts, filters, tables, charts, dialogs, cards, copy, spacing, or visual hierarchy
- the task must preserve dark mode, mobile, loading, empty, or error states
- the task touches `apps/web/src/app`, `apps/web/src/components`, or page-level UX

Use the backend specialist when:
- the task changes route handlers, server actions, server components, query parsing, auth-gated loaders, or API contracts
- the task touches `apps/web/src/app/api`, `apps/web/src/lib/actions`, `apps/web/src/lib/*`, or data assembly in server pages
- the problem is a mismatch between frontend expectations and returned data

Use the database specialist when:
- the task changes migrations, SQL functions, RPCs, views, materialized views, indexes, backfills, or data semantics
- the issue involves counting, duplication, performance, source-of-truth conflicts, or SQL safety
- the task touches `supabase/migrations` or depends on canonical Supabase objects

Use the devops specialist when:
- the task changes build, deploy, CI, environment variables, scripts, cron/jobs, import pipelines, or runtime diagnostics
- the issue is reproducible only in deploy/build environments
- the task touches `jobs/`, `scripts/`, package scripts, or operational automation

Use the security specialist when:
- the task touches authentication, authorization, RLS, service-role usage, secrets, exports, uploads/imports, or sensitive data
- the change increases system reach, data exposure, or trust boundaries
- the request includes a review for abuse, leakage, or privilege escalation risk

## Mandatory co-review rules

Frontend + backend:
- when UX changes depend on new filters, payloads, or server data shapes

Backend + database:
- when data correctness, aggregations, SQL performance, or source-of-truth semantics are involved

Backend + security:
- when auth scope, admin-only flows, uploads, exports, or service-role access are changed

Database + security:
- when a migration changes access patterns, security definer functions, RLS, or sensitive views

Devops + security:
- when env vars, pipelines, secrets, or external integrations are added or changed

## Shared operating rules

Always load project context before substantial work:
- read [`project-context.md`](./.codex/context/project-context.md)
- read [`docs/CONTEXTO_SISTEMA.md`](./docs/CONTEXTO_SISTEMA.md) for database, analytics, cockpit, or workflow changes

Preserve canonical rules:
- do not replace canonical views with ad hoc sources
- prefer existing source-of-truth tables, views, and RPCs over duplicated logic
- do not infer business counts from operational joins if a canonical dimension exists

Supabase migration rules:
- append a new sequential migration instead of rewriting history when the environment may already be applied
- use idempotent patterns where possible
- use `CREATE OR REPLACE VIEW`, never `DROP VIEW` plus `CREATE VIEW`
- include `SET search_path = public` in `SECURITY DEFINER` functions

Validation rules:
- UI changes: validate dark mode, responsive behavior, loading, empty, and error states
- backend changes: validate contract compatibility and failure behavior
- DB changes: validate expected count semantics and backfill safety
- deploy/runtime changes: validate build and environment assumptions

## Handoff contract

Every specialist handoff should include:
- goal
- scope
- changed files or objects
- assumptions
- validation run
- residual risk

The orchestrator should not accept a handoff that only says "done".

## Day-to-day usage

Recommended prompts:

1. Broad feature:
   "Use the principal orchestrator. Pull in frontend, backend, and database only if needed. Keep one owner and one validation plan."

2. UI-only:
   "Use the frontend specialist. Preserve dark mode, mobile, loading, empty, and error states."

3. SQL-heavy:
   "Use the database specialist first. Treat existing views and RPCs as contracts unless the change explicitly replaces them."

4. Risky auth/export flow:
   "Use backend with security review before finalizing."

## Structure

Recommended project-local layout:

```text
AGENTS.md
.codex/
  agents/
    principal-orchestrator.md
    frontend-specialist.md
    backend-specialist.md
    database-specialist.md
    devops-specialist.md
    security-specialist.md
  skills/
    context/
      project-context.md
    repo-context/
      SKILL.md
    frontend-admin-ui/
      SKILL.md
    backend-supabase/
      SKILL.md
    database-safe-migrations/
      SKILL.md
    devops-verification/
      SKILL.md
    security-review/
      SKILL.md
```
