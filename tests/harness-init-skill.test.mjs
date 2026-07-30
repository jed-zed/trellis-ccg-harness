import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_ROOT = path.join(ROOT, '.agents', 'skills', 'harness-init')

async function readSkillFile(...parts) {
  return readFile(path.join(SKILL_ROOT, ...parts), 'utf8')
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('harness-init is a discoverable project-start skill', async () => {
  const skill = await readSkillFile('SKILL.md')
  const openai = await readSkillFile('agents', 'openai.yaml')

  assert.match(skill, /^---\r?\nname: harness-init\r?\n/m)
  assert.match(skill, /description:.*Harness/i)
  assert.match(skill, /project start|new project|existing repository/i)
  assert.match(openai, /display_name: "Harness Init"/)
  assert.match(openai, /default_prompt: "Use \$harness-init /)
  assert.match(openai, /allow_implicit_invocation: true/)
})

test('harness-init discovers evidence before asking one grill-me question', async () => {
  const skill = await readSkillFile('SKILL.md')

  assert.match(skill, /grill-me/)
  assert.match(skill, /one question at a time/i)
  assert.match(skill, /answerable from (?:the )?repository/i)
  assert.match(skill, /confirmed facts/i)
  assert.match(skill, /unresolved decisions/i)
  assert.match(skill, /explicit approval/i)
  assert.match(skill, /do not (?:write|mutate)[\s\S]*before/i)
})

test('harness-init covers the complete constraint contract and safe handoff', async () => {
  const skill = await readSkillFile('SKILL.md')
  const checklist = await readSkillFile('references', 'constraint-checklist.md')
  const template = JSON.parse(
    await readSkillFile('assets', 'project-contract.template.json'),
  )

  for (const required of [
    'business',
    'repository',
    'architecture',
    'toolchain',
    'quality',
    'security',
    'providers',
    'hooks',
    'source',
    'rollback',
    'CI',
  ]) {
    assert.match(checklist, new RegExp(required, 'i'))
  }

  assert.match(skill, /trellis-spec-bootstrap/)
  assert.match(skill, /doctor/)
  assert.match(skill, /conflict/i)
  assert.match(skill, /Grok.*Claude.*GPT Pro/i)
  assert.equal(template.schemaVersion, 1)
  assert.equal(template.status, 'draft')
  assert.deepEqual(template.unresolvedDecisions, [])
  assert.ok(template.project)
  assert.ok(template.authorities)
  assert.ok(template.workflow)
  assert.ok(template.toolchain)
  assert.ok(template.qualityGates)
  assert.ok(template.security)
  assert.ok(template.providers)
  assert.ok(template.source)
  assert.deepEqual(template.thirdParty, {
    sourceManifestSha256: null,
    globalSkills: [],
    globalPlugins: [],
    projectSkills: [],
    mcpCli: [],
    excluded: [],
  })
})

test('harness-init delegates contract mutation to the executable validator', async () => {
  const skill = await readSkillFile('SKILL.md')
  const schema = JSON.parse(
    await readSkillFile('assets', 'project-contract.schema.json'),
  )
  const core = await readSkillFile('scripts', 'harness-init-core.mjs')

  assert.match(skill, /harness-init\.mjs inspect/)
  assert.match(skill, /harness-init\.mjs validate/)
  assert.match(skill, /harness-init\.mjs apply/)
  assert.match(skill, /status.*approved/is)
  assert.match(core, /validateProjectContract/)
  assert.match(core, /Credential or secret/)
  assert.equal(schema.properties.authorities.properties.lifecycle.const, 'trellis')
  assert.equal(schema.properties.workflow.properties.dispatchMode.const, 'inline')
  assert.ok(schema.required.includes('thirdParty'))
})

test('harness-init refines and reuses the 14-Skill global platform profile', async () => {
  const skill = await readSkillFile('SKILL.md')
  const template = JSON.parse(
    await readSkillFile('assets', 'project-contract.template.json'),
  )
  const schema = JSON.parse(
    await readSkillFile('assets', 'project-contract.schema.json'),
  )

  assert.match(skill, /first trigger|first-run/i)
  assert.match(skill, /Skill repository/i)
  assert.match(skill, /global.*(?:minimal|essential)/is)
  assert.match(skill, /project(?:-local|-level).*\.agents\/skills/is)
  assert.match(skill, /saved path|do not ask.*path again/is)
  assert.match(skill, /configure-skills/)
  assert.match(skill, /catalog-skills/)
  assert.match(skill, /install-skills/)
  assert.match(skill, /recommend[\s\S]*explicit approval/i)
  assert.deepEqual(template.skills, {
    globalPolicy: 'minimal-essential-only',
    globalEssential: [
      'chatgpt-pro-sidebar',
      'harness-init',
      'trellis-before-dev',
      'trellis-brainstorm',
      'trellis-break-loop',
      'trellis-channel',
      'trellis-check',
      'trellis-continue',
      'trellis-finish-work',
      'trellis-meta',
      'trellis-session-insight',
      'trellis-spec-bootstrap',
      'trellis-start',
      'trellis-update-spec',
    ],
    repositoryProfile: 'user-saved',
    selectionMode: 'recommend-and-approve',
    installMode: 'copy',
    projectSelection: [],
  })
  assert.ok(schema.required.includes('skills'))
  assert.equal(
    schema.properties.skills.properties.globalPolicy.const,
    'minimal-essential-only',
  )
  assert.equal(
    schema.properties.skills.properties.installMode.const,
    'copy',
  )
})

test('root AGENTS projects the canonical collaboration policy', async () => {
  const rootAgents = await readFile(path.join(ROOT, 'AGENTS.md'), 'utf8')
  const policy = await readSkillFile('assets', 'collaboration-policy.md')
  const pinnedPolicy = await readFile(
    path.join(ROOT, '.harness', 'policies', 'collaboration-policy.md'),
    'utf8',
  )
  const start = '<!-- HARNESS-COLLABORATION:START -->'
  const end = '<!-- HARNESS-COLLABORATION:END -->'
  const startIndex = rootAgents.indexOf(start)
  const endIndex = rootAgents.indexOf(end)

  assert.ok(startIndex >= 0)
  assert.ok(endIndex > startIndex)
  assert.equal(rootAgents.indexOf(start, startIndex + start.length), -1)
  assert.equal(rootAgents.indexOf(end, endIndex + end.length), -1)
  assert.equal(
    rootAgents.slice(startIndex + start.length, endIndex).trim(),
    policy.trim(),
  )
  assert.equal(pinnedPolicy, policy)
})

test('root Harness contract pins the 14-core and reject-all third-party baseline', async () => {
  const contractText = await readFile(
    path.join(ROOT, '.harness', 'project.json'),
    'utf8',
  )
  const schemaText = await readFile(
    path.join(ROOT, '.harness', 'project.schema.json'),
    'utf8',
  )
  const productManagerSchemaText = await readFile(
    path.join(ROOT, '.harness', 'product-manager.schema.json'),
    'utf8',
  )
  const sourceText = await readFile(
    path.join(ROOT, '.harness', 'third-party-sources.json'),
    'utf8',
  )
  const ownership = JSON.parse(
    await readFile(path.join(ROOT, '.harness', 'ownership.json'), 'utf8'),
  )
  const distributionSchema = await readSkillFile(
    'assets',
    'project-contract.schema.json',
  )
  const distributionSource = await readSkillFile(
    'assets',
    'third-party-sources.json',
  )
  const distributionProductManagerSchema = await readSkillFile(
    'assets',
    'product-manager.schema.json',
  )
  const contract = JSON.parse(contractText)
  const sourceSha256 = sha256(canonicalJson(JSON.parse(sourceText)))

  assert.equal(contract.skills.globalEssential.length, 14)
  assert.equal(
    contract.skills.globalEssential.includes('chatgpt-pro-sidebar'),
    true,
  )
  assert.equal(contract.skills.globalEssential.includes('grill-me'), false)
  assert.deepEqual(contract.thirdParty, {
    sourceManifestSha256: sourceSha256,
    globalSkills: [],
    globalPlugins: [],
    projectSkills: [],
    mcpCli: [],
    excluded: [],
  })
  assert.equal(schemaText, canonicalJson(JSON.parse(distributionSchema)))
  assert.equal(
    productManagerSchemaText,
    canonicalJson(JSON.parse(distributionProductManagerSchema)),
  )
  assert.equal(sourceText, canonicalJson(JSON.parse(distributionSource)))
  assert.equal(ownership.contractSha256, sha256(contractText))
  assert.equal(ownership.schemaSha256, sha256(schemaText))
  assert.equal(
    ownership.productManagerSchemaSha256,
    sha256(productManagerSchemaText),
  )
  assert.equal(ownership.thirdPartySourceManifestSha256, sourceSha256)
  assert.ok(
    ownership.managedPaths.includes('.harness/third-party-sources.json'),
  )
})
