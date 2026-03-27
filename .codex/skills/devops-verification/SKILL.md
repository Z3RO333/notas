---
name: devops-verification
description: Use when diagnosing build, deploy, CI, runtime, script, job, or environment issues for this repository, including Vercel and Databricks-adjacent flows.
---

# Devops Verification

Use together with:
- [`../repo-context/SKILL.md`](../repo-context/SKILL.md)

Primary scope:
- `apps/web` build and runtime validation
- `jobs/`
- `scripts/`
- package scripts and deployment checks

Workflow:
1. Reproduce with the closest available command path.
2. Separate code failures from environment or cache failures.
3. Check whether the issue is:
   - build-only
   - runtime-only
   - env-only
   - deploy-specific
4. Keep fixes explicit and observable.

Common checks:
- `cd apps/web && npm run build`
- relevant `npm test` target
- env var presence and expected usage path
- script assumptions about cwd, shell, and credentials
