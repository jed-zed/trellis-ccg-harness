import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_ROOT = path.join(ROOT, '.agents', 'skills', 'harness-init')

async function readSkillFile(...parts) {
  return readFile(path.join(SKILL_ROOT, ...parts), 'utf8')
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
})

test('harness-init refines and reuses a minimal-global project Skill profile', async () => {
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
    globalEssential: ['grill-me', 'harness-init'],
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
