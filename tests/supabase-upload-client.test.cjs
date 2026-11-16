const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript'), fs = require('node:fs'), Module = require('node:module');

const run = async (status, action) => {
  const oldFetch = global.fetch, oldXhr = global.XMLHttpRequest, oldLoad = Module._load;
  const file = require.resolve('../src/api/sharedSongUploads.web.ts'), extension = require.extensions['.ts'];
  const calls = [], uploads = [];
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  Module._load = function (id, parent, ...rest) {
    if (parent?.filename === file && id === './sharedApiUrl') return { buildSharedApiUrl: value => value };
    if (parent?.filename === file && id === '../store/adminSession') return { invalidateAdminSession() {} };
    return oldLoad.call(this, id, parent, ...rest);
  };
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('storage-context')) return { ok: true, json: async () => ({ namespace: 'production', maximumUploadBytes: 50 * 1024 * 1024, ...status }) };
    const body = JSON.parse(options.body), pathname = body.payload.pathname;
    assert.equal(body.payload.contentType, 'audio/mpeg'); assert.equal(body.payload.size, 3);
    return { ok: true, json: async () => ({ upload: { provider: 'supabase', pathname,
      signedUrl: `https://fixture.supabase.co/storage/v1/object/upload/sign/theatre-media/${pathname}?token=file-only`,
      publicUrl: `https://fixture.supabase.co/storage/v1/object/public/theatre-media/${pathname}` } }) };
  };
  global.XMLHttpRequest = class {
    constructor() { this.headers = {}; this.upload = {}; uploads.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(file) { this.file = file; this.status = 200; this.response = { Key: 'theatre-media/ok' }; this.onload(); }
  };
  try {
    delete require.cache[file]; const api = require(file);
    await action(api, calls, uploads);
  } finally {
    global.fetch = oldFetch; global.XMLHttpRequest = oldXhr; Module._load = oldLoad; delete require.cache[file];
    if (extension) require.extensions['.ts'] = extension; else delete require.extensions['.ts'];
  }
};

test('the browser uploads an MP3 directly with its path-limited grant, without Blob or a service key, and retains progress and metadata', async () => run({}, async (api, calls, uploads) => {
  const progress = [], file = new File(['mp3'], 'voice.mp3');
  const result = await api.uploadSharedSongAudio({ shareId: 'work', targetId: 'number', targetType: 'musical-number', file, onUploadProgress: value => progress.push(value) });
  assert.equal(calls.length, 2); assert.equal(uploads.length, 1);
  assert.equal(uploads[0].headers['Content-Type'], 'audio/mpeg');
  assert.equal(uploads[0].headers.authorization, undefined);
  assert.ok(uploads[0].url.startsWith('https://fixture.supabase.co/storage/v1/object/upload/sign/'));
  assert.ok(result.url.includes('/object/public/theatre-media/')); assert.equal(result.contentType, 'audio/mpeg');
  assert.deepEqual(progress, [100]); assert.equal(result.size, 3);
}));

test('oversized files and protected storage are rejected before requesting a grant or sending any bytes', async () => {
  await run({}, async (api, calls, uploads) => {
    await assert.rejects(api.uploadSharedSongAudio({ shareId: 'work', targetId: 'number', file: { name: 'large.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 + 1 } }), /50 MB/);
    assert.equal(calls.length, 1); assert.equal(uploads.length, 0);
  });
  await run({ readOnly: true, message: 'Espera al almacenamiento.' }, async (api, calls, uploads) => {
    await assert.rejects(api.uploadSharedSongAudio({ shareId: 'work', targetId: 'number', file: new File(['mp3'], 'voice.mp3') }), /Espera al almacenamiento/);
    assert.equal(calls.length, 1); assert.equal(uploads.length, 0);
  });
});
