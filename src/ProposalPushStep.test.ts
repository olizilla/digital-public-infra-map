// The push step of .github/workflows/proposal-accept.yml (D88, D96): the token is for git alone, so the scripts
// and the data check it runs never have it, and its guard still works. The step's shell script is read from the
// workflow and run in bash, with a fake token and a local stand-in for the remote.
// Run with: node --test src/ProposalPushStep.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// D96: the push step has the token for git, and nothing it runs afterwards does

/** The push step's script in .github/workflows/proposal-accept.yml, as the shell gets it */
function pushScript () {
  const yml = fs.readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', 'proposal-accept.yml'), 'utf8')
  const step = yml.slice(yml.indexOf('- name: Push, rebasing'))
  const run = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length)
  const lines: string[] = []
  for (const line of run.split('\n')) {
    if (line.trim() !== '' && !line.startsWith('          ')) break
    lines.push(line.slice(10))
  }
  return lines.join('\n')
}

test('the push step puts the token in an unexported shell variable and unsets it before anything else runs (D96)', () => {
  const script = pushScript()
  const before = script.slice(0, script.indexOf('file=$(jq'))
  assert.match(before, /^remote="https:\/\/x-access-token:\$\{TOKEN\}@github\.com\/\$\{GITHUB_REPOSITORY\}\.git"$/m)
  assert.match(before, /^unset TOKEN$/m)
  // no command runs between taking it and unsetting it, and no node, npm or script before the unset
  const lines = script.split('\n').filter(line => !line.startsWith('#') && line.trim())
  assert.match(lines[0], /^remote=/)
  assert.equal(lines[1], 'unset TOKEN')
  assert.doesNotMatch(script.slice(0, script.indexOf('unset TOKEN')), /\bnode\b|\bnpm\b/)
  // run it with a fake token: a child process sees none, nor `remote`, and the shell still has the URL for git
  const probe = [
    before,
    `node -e 'console.log("TOKEN=" + process.env.TOKEN, "remote=" + process.env.remote)'`,
    `env | grep -c fake-token || true`,
    `case "$remote" in https://x-access-token:fake-token@github.com/o/r.git) echo shell-has-remote;; esac`
  ].join('\n')
  const ran = spawnSync('bash', ['-ec', probe], { encoding: 'utf8', env: { PATH: process.env.PATH, TOKEN: 'fake-token', GITHUB_REPOSITORY: 'o/r' } })
  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(ran.stdout.trim().split('\n'), ['TOKEN=undefined remote=undefined', '0', 'shell-has-remote'])
})

test('the push step’s guard still works with $remote, on a local stand-in for the remote (D96)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-step-test-'))
  try {
    const sh = (cwd: string, ...args: string[]) => {
      const ran = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], { cwd, encoding: 'utf8' })
      assert.equal(ran.status, 0, ran.stderr)
      return ran.stdout
    }
    const remote = path.join(dir, 'remote.git')
    sh(dir, 'init', '--quiet', '--bare', '-b', 'main', remote)
    const work = path.join(dir, 'work')
    sh(dir, 'clone', '--quiet', remote, work)
    sh(work, 'checkout', '--quiet', '-b', 'main')
    fs.writeFileSync(path.join(work, 'README.md'), 'x\n')
    sh(work, 'add', '.')
    sh(work, 'commit', '--quiet', '-m', 'first')
    sh(work, 'push', '--quiet', 'origin', 'main')
    const file = 'changesets/next/payment/2026-11-15T120000Z-abcd.toml'
    const result = path.join(dir, 'accept.json')
    fs.writeFileSync(result, JSON.stringify({ file }))
    // the script as the workflow has it, with the URL swapped for the stand-in (the token is still taken and unset)
    const script = pushScript().replace(/^remote=".*"$/m, `remote="${remote}"; : "\${TOKEN}"`)
    assert.ok(script.includes(`remote="${remote}"`))
    const run = () => spawnSync('bash', ['-e', '-c', script], {
      cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, TOKEN: 'fake-token', GITHUB_REPOSITORY: 'o/r', BRANCH: 'main', RESULT: result, VERIFY: path.join(dir, 'verify.json'), GITHUB_OUTPUT: path.join(dir, 'out') }
    })
    // a commit that adds the file, and only it, is pushed
    fs.mkdirSync(path.join(work, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(work, file), 'x = 1\n')
    sh(work, 'add', '.')
    sh(work, 'commit', '--quiet', '-m', 'data: accepted')
    const pushed = run()
    assert.equal(pushed.status, 0, pushed.stdout + pushed.stderr)
    assert.match(fs.readFileSync(path.join(dir, 'out'), 'utf8'), /^pushed=true$/m)
    assert.equal(sh(remote, 'rev-parse', 'main').trim(), sh(work, 'rev-parse', 'HEAD').trim())
    // a commit that changes something else is not
    fs.writeFileSync(path.join(work, 'README.md'), 'changed\n')
    fs.writeFileSync(path.join(work, file), 'x = 2\n')
    sh(work, 'add', '.')
    sh(work, 'commit', '--quiet', '-m', 'sneaky')
    const refused = run()
    assert.notEqual(refused.status, 0)
    assert.match(refused.stdout, /The commit changes more than/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
