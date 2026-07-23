#!/usr/bin/env node
import readline from 'node:readline'

const input = process.argv.slice(2)
const caseIndex = input.indexOf('--fake-case')
const fakeCase = caseIndex >= 0 ? input[caseIndex + 1] : 'success'
const args = caseIndex >= 0 ? input.filter((_, index) => index !== caseIndex && index !== caseIndex + 1) : input

if (args.includes('version')) {
  process.stdout.write('0.1.20\n')
  process.exit(0)
}
if (args.includes('models')) {
  process.stdout.write('grok-4.5\n')
  process.exit(0)
}
if (args.includes('inspect')) {
  process.stdout.write(fakeCase === 'inspect-pollution'
    ? '{"externalCompat":{"remoteSettingsLoaded":false,"cells":[{"vendor":"claude","surface":"hooks","enabled":true}]}}'
    : '{"externalCompat":{"remoteSettingsLoaded":false,"cells":[{"vendor":"claude","surface":"hooks","enabled":false}]}}')
  process.exit(0)
}
if (args.includes('plugin') || args.includes('mcp')) {
  process.stdout.write(fakeCase === 'inspect-pollution' ? 'polluted enabled\n' : 'none configured\n')
  process.exit(0)
}

if (!args.includes('agent') || !args.includes('stdio')) {
  process.stderr.write('fake wrapper received unsupported arguments\n')
  process.exit(2)
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const respond = (id, result = {}) => send({ jsonrpc: '2.0', id, result })
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (fakeCase === 'malformed-json') {
    process.stdout.write('{malformed\n')
    return
  }
  const message = JSON.parse(line)
  if (message.method === 'initialize')
    return respond(message.id, { authMethods: [{ id: 'cached_token' }], agentCapabilities: { sessionCapabilities: { close: true } } })
  if (message.method === 'authenticate')
    return respond(message.id, {})
  if (message.method === 'session/new') {
    respond(message.id, { sessionId: 'fake-session' })
    send({ method: '_x.ai/mcp/servers_updated', params: { mcpServers: fakeCase === 'mcp-pollution' ? [{ name: 'polluted' }] : [] } })
    send({ method: '_x.ai/mcp_initialized', params: { mcpToolCount: 0 } })
    return
  }
  if (message.method === 'session/prompt') {
    if (fakeCase === 'timeout')
      return
    if (fakeCase === 'rate-limit')
      return send({ jsonrpc: '2.0', id: message.id, error: { code: 429, message: 'rate limit' } })
    respond(message.id, { complete: true })
    return
  }
  if (message.method === 'session/close') {
    respond(message.id, { closed: true })
    setTimeout(() => process.exit(0), 5)
  }
})
