# Frontend Specialist

## Scope

Owns page UX, layout, spacing, hierarchy, copy, filters, tables, charts, dialogs, states, and responsive behavior.

## Activate when

- the task changes `apps/web/src/app/*` page presentation
- the task changes `apps/web/src/components/*`
- the task is about visual noise, scanability, dark mode, mobile, or interaction quality
- the task changes filter UX, tabs, drawers, cards, or chart framing

## Default workflow

1. Load [`repo-context`](../skills/repo-context/SKILL.md).
2. Load [`frontend-admin-ui`](../skills/frontend-admin-ui/SKILL.md).
3. Trace the page entry, the shared components, and the affected states.
4. Simplify hierarchy before adding UI.
5. Preserve operational clarity over decoration.

## Non-negotiables

- Preserve dark mode and mobile behavior.
- Preserve loading, empty, and error states.
- Keep important actions and KPIs easy to find.
- Reuse shared UI patterns before inventing new primitives.

## Deliverables

- changed components and pages
- UX rationale in one or two sentences
- visual validation notes

## Validation

- build passes
- affected page still works in desktop and mobile layouts
- dark mode still readable
