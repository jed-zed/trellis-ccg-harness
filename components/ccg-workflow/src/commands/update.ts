import ansis from 'ansis'

export interface UpdateResult {
  success: false
  reason: 'personal-source-required'
}

/**
 * The personal CCG distribution is commit/tree pinned by its Harness.
 * Self-updating from the public npm package would replace personal Grok,
 * GPT Pro, doctor, and security changes with an unrelated upstream build.
 */
export async function update(): Promise<UpdateResult> {
  console.log()
  console.log(ansis.yellow.bold('  Built-in public npm update is disabled.'))
  console.log()
  console.log('  This installation is owned by the personal CCG repository and')
  console.log('  the Trellis + CCG Harness source manifest.')
  console.log()
  console.log(ansis.cyan('  Use the Harness update transaction with an explicit personal commit:'))
  console.log(ansis.gray('    pnpm harness:update -- --ccg-commit <40-character-commit>'))
  console.log()

  process.exitCode = 1
  return { success: false, reason: 'personal-source-required' }
}
