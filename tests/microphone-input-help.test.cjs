const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { getMicrophoneInputContext, getMicrophoneInputErrorMessage, asMicrophoneInputError } = require('../src/utils/microphoneInputHelp.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

test('installed Android and Chrome have separate microphone permission instructions', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 AITheatreNative/2026.11.225';
  assert.equal(getMicrophoneInputContext(ua, 'android'), 'android-app');
  assert.equal(getMicrophoneInputContext(ua), 'android-chrome');
  const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  const app = getMicrophoneInputErrorMessage(denied, 'android-app');
  assert.match(app, /Aplicaciones → AI-Theatre → Permisos → Micrófono/);
  assert.doesNotMatch(app, /navegador|Chrome/);
  const chrome = getMicrophoneInputErrorMessage(denied, 'android-chrome');
  assert.match(chrome, /Configuración de sitios → Micrófono/);
  assert.match(chrome, /ai-theater\.vercel\.app/);
  assert.match(chrome, /Aplicaciones → Chrome → Permisos/);
});

test('an unavailable device or busy input is not described as a denied browser permission', () => {
  for (const name of ['NotReadableError', 'AbortError', 'NotFoundError']) {
    const message = getMicrophoneInputErrorMessage({ name, message: 'capture failed' }, 'android-app');
    assert.doesNotMatch(message, /bloqueado|Permisos|navegador/);
    assert.match(message, name === 'NotFoundError' ? /No se encuentra/ : /ocupado/);
  }
});

test('unknown capture errors retain a bounded reason and a suspended processor has its own guidance', () => {
  const unknown = getMicrophoneInputErrorMessage({ name: 'CaptureError', message: 'x'.repeat(500) }, 'android-app');
  assert.match(unknown, /Detalle: CaptureError/);
  assert.ok(unknown.length < 550);
  const suspended = getMicrophoneInputErrorMessage(new Error('audio-context-not-running'), 'android-app');
  assert.match(suspended, /Mantén la app visible/);
  assert.doesNotMatch(suspended, /Permisos/);
  assert.equal(asMicrophoneInputError({ name: 'NotAllowedError' }).name, 'NotAllowedError');
  assert.equal(asMicrophoneInputError('capture failed').message, 'capture failed');
});
