#!/usr/bin/env node
import cac from 'cac'
import { isCodexModeHelpRequest, printCodexModeHelp, setupCommands } from './cli-setup'

async function main(): Promise<void> {
  if (isCodexModeHelpRequest(process.argv.slice(2))) {
    printCodexModeHelp()
    return
  }

  const cli = cac('ccg')
  await setupCommands(cli)
  cli.parse()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
