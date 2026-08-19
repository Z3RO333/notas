# Public Operations Notes — Maintenance Cockpit

This public document intentionally avoids production infrastructure, internal identities, private URLs and operational troubleshooting procedures.

## Development checks

Before submitting changes, validate the project with:

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
```

## General troubleshooting approach

1. Identify whether the issue is in the UI, API, database or synchronization layer.
2. Trace the canonical data flow from source → database → server logic → interface.
3. Validate data semantics before changing KPI or routing logic.
4. Prefer versioned migrations for database changes.
5. Keep privileged credentials only in environment variables / secret stores.
6. Test changes in a non-production environment before deployment.

## Security policy

The public repository does not document:

- production project IDs or hostnames
- internal Azure resources
- private Databricks workspaces or paths
- real employee identities
- real business routing rules
- production e-mail addresses
- access instructions for internal systems
- incident procedures tied to production infrastructure

Operational runbooks are maintained privately.
