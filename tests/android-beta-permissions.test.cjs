const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { removeUnusedAudioServices } = require('../plugins/withBetaAndroidPermissions.cjs');
const app = require('../app.json').expo;

test('Android beta keeps microphone access but rejects permissions unrelated to foreground rehearsal', () => {
  for (const name of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) assert(app.android.permissions.includes(`android.permission.${name}`));
  for (const name of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'FOREGROUND_SERVICE_MICROPHONE']) {
    assert(app.android.blockedPermissions.includes(`android.permission.${name}`), name);
  }
  assert.equal(app.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-audio')[1].enableBackgroundRecording, false);
});

test('native manifest cleanup preserves speech queries, application settings and unrelated services', () => {
  const queries = [{ intent: [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] }] }];
  const other = { $: { 'android:name': 'example.OtherService', 'android:exported': 'false' } };
  const manifest = { $: { 'xmlns:android': 'android' }, queries, application: [{ $: { 'android:name': '.MainApplication' }, service: [other] }] };
  assert.equal(removeUnusedAudioServices(manifest), manifest);
  assert.equal(manifest.queries, queries);
  assert.equal(manifest.application[0].service[0], other);
  assert.deepEqual(manifest.application[0].$, { 'android:name': '.MainApplication' });
  assert.equal(manifest.$['xmlns:android'], 'android');
  assert.equal(manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  const removed = manifest.application[0].service.slice(1);
  assert.equal(removed.length, 2);
  assert(removed.every(service => service.$['tools:node'] === 'remove'));
});

test('service exclusions replace inherited registrations and remain idempotent across prebuilds', () => {
  const manifest = { application: [{ service: [
    { $: { 'android:name': 'expo.modules.audio.service.AudioControlsService', 'android:foregroundServiceType': 'mediaPlayback' } },
    { $: { 'android:name': 'expo.modules.audio.service.AudioRecordingService', 'android:foregroundServiceType': 'microphone' } },
  ] }] };
  removeUnusedAudioServices(manifest);
  const once = JSON.stringify(manifest);
  removeUnusedAudioServices(manifest);
  assert.equal(JSON.stringify(manifest), once);
  for (const service of manifest.application[0].service) assert.deepEqual(Object.keys(service.$).sort(), ['android:name', 'tools:node']);
  assert.throws(() => removeUnusedAudioServices({}), /aplicación Android/);
});

test('the service cleanup is registered and traversable in the actual Expo build archive', () => {
  const file = 'plugins/withBetaAndroidPermissions.cjs';
  assert(app.plugins.includes(`./${file}`));
  const ignore = require('ignore')().add(fs.readFileSync('.easignore', 'utf8'));
  assert(fs.existsSync(file));
  assert.equal(ignore.ignores('plugins'), false);
  assert.equal(ignore.ignores('plugins/'), false);
  assert.equal(ignore.ignores(file), false);
  assert.equal(ignore.ignores('plugins/unrelated-secret.json'), true);
});
