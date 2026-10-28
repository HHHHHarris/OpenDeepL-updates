'use strict';

// Integration test: two staged builds retain the same certificate-anchored DR.
// No app is installed or launched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin' || process.env.OPENDEEPL_SIGNING_TESTS !== '1') {
  require('node:test')('macOS signing integration', { skip: 'Set OPENDEEPL_SIGNING_TESTS=1 on a prepared Mac' }, () => {});
} else {

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opendeepl-sign-test-'));
const rollbackHome = fs.mkdtempSync('/tmp/opendeepl-sign-rollback-');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function requirement(app) {
  const output = run('/usr/bin/codesign', ['-d', '-r-', app]);
  return output.match(/^designated => (.+)$/m)?.[1];
}

function cdhash(app) {
  return run('/usr/bin/codesign', ['-dvvvv', app]).match(/^CDHash=([0-9a-f]+)$/m)?.[1];
}

try {
  const a = path.join(temp, 'first.app');
  const b = path.join(temp, 'second.app');
  run(path.join(root, 'scripts/build_desktop.sh'), ['--output', a], { ...process.env, OPENDEEPL_BUILD_TAG: 'sign-test-first' });
  run(path.join(root, 'scripts/build_desktop.sh'), ['--output', b], { ...process.env, OPENDEEPL_BUILD_TAG: 'sign-test-second' });
  assert.ok(cdhash(a) && cdhash(b), 'missing root CDHash');
  assert.notEqual(cdhash(a), cdhash(b), 'the two signed bundles must differ');
  for (const suffix of ['', '/Contents/Helpers/OpenDeepLContextService.app', '/Contents/Helpers/double-copy-macos']) {
    const first = `${a}${suffix}`;
    const second = `${b}${suffix}`;
    const firstRequirement = requirement(first);
    const secondRequirement = requirement(second);
    assert.ok(firstRequirement?.includes('certificate root = H"'), `certificate anchor missing for ${suffix}`);
    assert.equal(firstRequirement, secondRequirement, `designated requirement drifted for ${suffix}`);
    run('/usr/bin/codesign', ['--verify', '--strict', `-R=${firstRequirement}`, second]);
    run('/usr/bin/codesign', ['--verify', '--strict', `-R=${secondRequirement}`, first]);
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', a]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', b]);
  const prior = path.join(rollbackHome, 'Applications', 'OpenDeepL.app');
  fs.mkdirSync(path.dirname(prior), { recursive: true });
  run('/usr/bin/ditto', [a, prior]);
  const priorHash = cdhash(prior);
  const signingDir = path.join(process.env.HOME, 'Library/Application Support/OpenDeepL/build-signing');
  const rollbackEnv = {
    ...process.env,
    HOME: rollbackHome,
    OPENDEEPL_TEST_MODE: '1',
    OPENDEEPL_TEST_FAIL_REGISTER: '1',
    OPENDEEPL_BUILD_TAG: 'sign-test-failed-install',
    OPENDEEPL_SIGNING_CERT: process.env.OPENDEEPL_SIGNING_CERT || path.join(signingDir, 'local.crt'),
    OPENDEEPL_SIGNING_KEY: process.env.OPENDEEPL_SIGNING_KEY || path.join(signingDir, 'local.key'),
  };
  const failedInstall = spawnSync(path.join(root, 'scripts/build_desktop.sh'), [], {
    encoding: 'utf8', cwd: root, env: rollbackEnv, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(failedInstall.status, 97, `expected injected registration failure: ${failedInstall.stdout}\n${failedInstall.stderr}`);
  assert.match(failedInstall.stderr, /Restored previous App after failed install/);
  assert.equal(cdhash(prior), priorHash, 'previous app was not restored byte-for-byte at its signed identity');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', prior]);
  const retained = fs.readdirSync(path.join(rollbackHome, 'rollback-evidence'))
    .filter((name) => name.endsWith('.failed.app.rollback'));
  assert.equal(retained.length, 1, 'failed new bundle was not retained');
  const failedBundle = path.join(rollbackHome, 'rollback-evidence', retained[0]);
  assert.notEqual(cdhash(failedBundle), priorHash, 'failed and restored bundles should be distinct');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', failedBundle]);
  console.log('Two distinct staged builds verified; isolated failed install restored prior App and retained failed bundle.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(rollbackHome, { recursive: true, force: true });
}

}
