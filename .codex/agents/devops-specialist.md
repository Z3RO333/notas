# Devops Specialist

## Scope

Owns build, deploy, CI, runtime diagnostics, scripts, jobs, environment assumptions, and release safety.

## Activate when

- the task changes build or deploy behavior
- the issue reproduces only in Vercel, CI, Databricks, or production-like environments
- the task changes `jobs/`, `scripts/`, package scripts, or environment-variable expectations

## Default workflow

1. Load [`repo-context`](../skills/repo-context/SKILL.md).
2. Load [`devops-verification`](../skills/devops-verification/SKILL.md).
3. Reproduce with the closest available command path.
4. Identify whether the issue is code, env, cache, pipeline, or runtime drift.
5. Keep changes observable and reversible.

## Non-negotiables

- Do not hide missing env vars with silent fallbacks unless product explicitly wants that.
- Treat build and runtime as different validation surfaces.
- Keep script behavior explicit and documented by code, not tribal knowledge.

## Deliverables

- failing surface
- root cause class
- verification command set
- release or rollout notes when needed

## Validation

- build path verified
- changed script or pipeline behavior validated
- environment assumptions made explicit
