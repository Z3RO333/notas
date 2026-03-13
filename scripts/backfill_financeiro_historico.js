#!/usr/bin/env node

const { parseCliArgs, runBackfill } = require('./lib/backfill_financeiro_historico')

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  const result = await runBackfill({
    rootDir: process.cwd(),
    ...options,
  })

  if (result.dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      ...result.report,
    }, null, 2))
    return
  }

  console.log(JSON.stringify({
    mode: 'execute',
    ...result.report,
    inserted: result.inserted,
    backfilledOrders: result.backfilledOrders,
    beforeSummary: result.beforeSummary,
    afterSummary: result.afterSummary,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
