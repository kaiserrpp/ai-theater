const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/letra-genius.html'), 'utf8').replace(/\r\n/g, '\n');
const viewer = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function openViewer({ framed = true } = {}) {
  const status = {};
  const retry = { hidden: true, addEventListener: (name, listener) => { retry[name] = listener; } };
  const window = { origin: framed ? 'null' : 'https://ai-theater.vercel.app' };
  window.top = framed ? {} : window;
  const messageHandlers = { ReactNativeWebView: { postMessage: assert.fail } };
  Object.defineProperty(window, 'webkit', { get: () => ({ messageHandlers }), configurable: false });

  const workers = [];
  class Worker {
    constructor(url) { this.url = url; workers.push(this); }
    terminate() { this.terminated = true; }
  }
  vm.runInNewContext(viewer, {
    window,
    document: { getElementById: id => ({ status, retry })[id] },
    location: { search: '?cancion=141424' },
    URLSearchParams,
    Blob,
    URL: { createObjectURL: () => 'blob:null/lyrics', revokeObjectURL() {} },
    Worker,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  return { window, messageHandlers, status, retry, workers };
}

test('Genius loads in a worker when the installed WebKit bridge is read-only', () => {
  const hash = createHash('sha256').update(viewer).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), 'The iframe policy allows the first-party script');
  const { window, messageHandlers, status, retry, workers } = openViewer();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].url, 'blob:null/lyrics');
  assert.equal(window.webkit.messageHandlers, messageHandlers);
  workers[0].onmessage({ data: null });
  assert.equal(workers[0].terminated, true);
  assert.match(status.textContent, /No se ha podido cargar/);
  assert.equal(retry.hidden, false);
  retry.click();
  assert.equal(workers.length, 2);
  assert.equal(retry.hidden, true);
  assert.match(status.textContent, /Cargando letra/);
});

test('Genius does not load from a top-level viewer document', () => {
  const { status, workers } = openViewer({ framed: false });
  assert.match(status.textContent, /Abre la letra desde el reproductor/);
  assert.equal(workers.length, 0);
});
