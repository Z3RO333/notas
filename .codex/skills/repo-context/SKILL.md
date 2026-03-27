---
name: repo-context
description: Use when working in this repository on any non-trivial task that needs project conventions, commands, architecture, canonical views, or Supabase rules before making changes.
---

# Repo Context

Load these references first:
- [`../../context/project-context.md`](../../context/project-context.md)
- [`../../../docs/CONTEXTO_SISTEMA.md`](../../../docs/CONTEXTO_SISTEMA.md) when the task touches database, analytics, cockpit semantics, or data flow

Core commands:
- `cd apps/web && npm run dev`
- `cd apps/web && npm test`
- `cd apps/web && npm run build`
- `npx supabase migration new <nome>`

Repository rules to keep in mind:
- `vw_notas_sem_ordem` and `vw_ordens_notas_painel` are canonical panel views
- `status_ordem_raw` is the source of truth for order status semantics
- prefer existing dimensions, views, and RPCs over ad hoc counting logic
- use `CREATE OR REPLACE VIEW`, never drop-create
- include `SET search_path = public` in `SECURITY DEFINER` functions

Use this skill before:
- changing data paths
- creating migrations
- changing admin flows
- touching analytics or cockpit logic
