const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const ts = require('typescript');
const { createVoicePilotHandler } = require('../server/voice-pilot');
const { issueAdminSession } = require('../server/admin-session');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createOpenAiRehearsalRecognition, hasCompleteOpenAiLine } = require('../src/utils/openAiRehearsalRecognition.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const env = { SONG_ADMIN_PASSWORD: 'test-admin', ADMIN_SESSION_SECRET: 'test-signing-key',
  SHARED_STORAGE_NAMESPACE: 'production', VERCEL_ENV: 'production' };
const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
before(() => Object.assign(process.env, env));
after(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const request = (method, body = { sdp: offer }, headers = {}) => {
  const req = { method, body, headers: { host: 'theatre.example', origin: 'https://theatre.example',
    'sec-fetch-site': 'same-origin', 'x-ai-theatre-admin': '1' } };
  const login = response();
  issueAdminSession(req, login, 'production', false);
  req.headers.cookie = login.headers['Set-Cookie'].split(';')[0];
  Object.assign(req.headers, headers);
  return req;
};
const response = () => Object.assign(new EventEmitter(), {
  headers: {}, headersSent: false, writableEnded: false, statusCode: 200,
  setHeader(name, value) { this.headers[name] = value; },
  status(value) { this.statusCode = value; return this; },
  json(body) { this.body = body; this.headersSent = this.writableEnded = true; },
  write(value) { this.headersSent = true; this.event = value; queueMicrotask(() => this.emit('close')); },
  end() { this.writableEnded = true; },
});
const fixture = (used = 0) => {
  const stored = new Map(Array.from({ length: used }, (_, n) => [`voice-pilot/production/${String(n).padStart(2, '0')}.json`, '{}']));
  const connections = [], closed = [];
  const storage = {
    async list() { return { blobs: [...stored.keys()].map(pathname => ({ pathname })) }; },
    async put(path, body, options) {
      assert.equal(options.allowOverwrite, false);
      await Promise.resolve();
      if (stored.has(path)) throw Object.assign(new Error('Duplicate'), { status: 409 });
      stored.set(path, body);
    },
  };
  const setup = {
    storage, settings: () => ({ key: 'server-secret' }), now: () => 1000,
    connect: async (...args) => {
      connections.push(args);
      return { callId: `rtc_${connections.length}`, answer: 'v=0\r\n' };
    },
    disconnect: async (_key, callId) => { closed.push(callId); },
  };
  return { handler: createVoicePilotHandler(setup), stored, connections, closed, setup };
};

test('OpenAI requires the real admin session before checking or reserving provider time', async () => {
  const f = fixture();
  const missing = response(), external = response(), lookup = response(), noWriteHeader = response();
  await f.handler(request('POST', { sdp: offer, isAdmin: true, password: env.SONG_ADMIN_PASSWORD }, {
    cookie: '', 'x-ai-theatre-pilot': 'ABC1-0012-3456-789A-BCDE-F012',
  }), missing);
  await f.handler(request('POST', undefined, { 'sec-fetch-site': 'cross-site' }), external);
  await f.handler(request('GET', undefined, { cookie: 'forged' }), lookup);
  await f.handler(request('POST', undefined, { 'x-ai-theatre-admin': '' }), noWriteHeader);
  assert.equal(missing.statusCode, 401);
  assert.equal(external.statusCode, 401);
  assert.equal(lookup.statusCode, 401);
  assert.equal(noWriteHeader.statusCode, 403);
  assert.equal(f.connections.length, 0);
  assert.equal(f.stored.size, 0);
});

test('private pilot reserves 30 minutes globally and caps concurrent requests at the final slot', async () => {
  const f = fixture(39);
  const first = response(), second = response();
  await Promise.all([f.handler(request('POST'), first), f.handler(request('POST'), second)]);
  assert.equal(f.stored.size, 40);
  assert.equal(f.connections.length, 1);
  assert.deepEqual(f.closed, ['rtc_1']);
  const accepted = first.event ? first : second;
  const declined = first.event ? second : first;
  assert.equal(declined.statusCode, 409);
  assert.match(accepted.event, /"remainingSeconds":0/);
  assert.doesNotMatch(accepted.event, /server-secret|rtc_1/);
  const status = response();
  await f.handler(request('GET'), status);
  assert.deepEqual(status.body, { remainingSeconds: 0, attemptSeconds: 0 });
});

test('private pilot reserves the entire window even after a lost response or failed setup', async () => {
  const f = fixture();
  const invalid = response(), failed = response();
  await f.handler(request('POST', { sdp: 'v=0' }), invalid);
  const broken = createVoicePilotHandler({ ...f.setup, connect: async () => { throw Error('sensitive response'); } });
  await broken(request('POST'), failed);
  assert.equal(invalid.statusCode, 400);
  assert.equal(failed.statusCode, 502);
  assert.equal(f.stored.size, 1);
  assert.equal(JSON.parse([...f.stored.values()][0]).reservedMs, 45_000);
  assert.doesNotMatch(JSON.stringify(failed.body), /sensitive response/);
});

test('actual rehearsals can reserve several existing slots but never reset the pilot budget', async () => {
  const f = fixture(35);
  const first = response(), second = response();
  await f.handler(request('POST', { sdp: offer, rehearsal: true }), first);
  assert.match(first.event, /"remainingMs":175000/);
  assert.match(first.event, /"remainingSeconds":45/);
  await f.handler(request('POST', { sdp: offer, rehearsal: true }), second);
  assert.match(second.event, /"remainingMs":40000/);
  assert.match(second.event, /"remainingSeconds":0/);
  assert.equal(f.stored.size, 40);
});

test('rehearsal voices stay private and can only be added by the existing administrator', async () => {
  const f = fixture(2);
  f.setup.storage.readJson = async path => JSON.parse(f.stored.get(path));
  const handler = createVoicePilotHandler(f.setup);
  const query = { action: 'voice-pack', share: 'share123', audition: 'audition-abc', revision: '1', scene: '2' };
  const clips = { 3: 'SUQzBAAAAA=' };
  const blocked = response(), added = response(), denied = response(), retrieved = response(), status = response();
  await handler({ ...request('PUT', { clips }, { 'x-ai-theatre-admin': '' }), query }, blocked);
  await handler({ ...request('PUT', { clips }), query }, added);
  await handler({ ...request('GET', undefined, { cookie: '' }), query }, denied);
  await handler({ ...request('GET'), query }, retrieved);
  await handler(request('GET'), status);
  assert.equal(blocked.statusCode, 403);
  assert.equal(added.statusCode, 201);
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(retrieved.body, { clips });
  assert.deepEqual(status.body, { remainingSeconds: 1710, attemptSeconds: 180 });
});

test('the live rehearsal waits for the ending, including when the same ending occurs twice', () => {
  const expected = 'Esta tarde quería ensayar despacio con vosotros y luego volver a casa.';
  assert.equal(hasCompleteOpenAiLine(expected, 'Esta tarde quería ensayar despacio con vosotros y luego volver'), false);
  assert.equal(hasCompleteOpenAiLine(expected, expected), true);
  assert.equal(hasCompleteOpenAiLine(expected, 'Esta tarde no quería ensayar despacio con vosotros y luego volver a casa'), false);
  const repeated = 'Volveré a casa cuando termine de ensayo y luego volveré a casa.';
  assert.equal(hasCompleteOpenAiLine(repeated, 'Volveré a casa'), false);
  assert.equal(hasCompleteOpenAiLine(repeated, repeated), true);
  assert.equal(hasCompleteOpenAiLine('Me queda un poco de gas, te puedo hacer café si quires',
    'Me queda un poco de gas, te puedo hacer café si quieres'), true);
});

test('OpenAI waits through pauses and releases each capture while reusing the connection across turns', async t => {
  let frame, clock = 1000, connections = 0, closed = 0, event;
  const tracks = [], sent = [];
  const makeStream = () => {
    const track = new EventTarget();
    track.readyState = 'live';
    track.stop = () => { track.readyState = 'ended'; };
    return { getAudioTracks: () => [track], getTracks: () => [track] };
  };
  const navigator = globalThis.navigator;
  const globals = {
    navigator: { ...navigator, mediaDevices: { async getUserMedia() {
      const stream = makeStream();
      tracks.push(stream.getAudioTracks()[0]);
      return stream;
    } } },
    requestAnimationFrame: callback => { frame = callback; return 1; },
    cancelAnimationFrame: () => { frame = undefined; },
    AudioContext: class {
      state = 'running';
      createMediaStreamDestination() { return { stream: makeStream() }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { connect() {}, disconnect() {}, fftSize: 32, getFloatTimeDomainData: data => data.fill(0) }; }
      async close() {}
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  t.mock.method(performance, 'now', () => clock);
  const lines = { first: 'Esta tarde quería ensayar despacio y luego volver a casa.', second: 'Mañana volvemos con todos.' };
  const adapter = createOpenAiRehearsalRecognition({
    getTarget: key => ({ accepts: text => hasCompleteOpenAiLine(lines[key], text) }),
    getThreshold: () => undefined,
    onUnauthorized: () => assert.fail('unexpected authorization error'),
    connect: async ({ onEvent }) => {
      connections++;
      event = onEvent;
      return {
        close: () => { closed++; },
        send: name => {
          sent.push(name);
          if (name === 'input_audio_buffer.clear') queueMicrotask(() => event({ type: 'input_audio_buffer.cleared' }));
        },
      };
    },
  });
  const session = createSpeechRecognitionSession(adapter.Constructor, () => {}, { controlledEnd: true, restartOnLineChange: true });
  t.after(() => { session.dispose(); adapter.close(); });
  const setLine = (enabled, lineKey) => session.configure({ enabled, lineKey, lang: 'es-ES' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const delta = (item_id, text) => event({ type: 'conversation.item.input_audio_transcription.delta', item_id, delta: text });
  const final = (item_id, text) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript: text });
  const advanceClock = ms => { clock += ms; frame?.(); };

  setLine(true, 'first');
  await settle();
  assert.equal(session.getSnapshot().isAudioActive, true);
  delta('turn1', 'Esta tarde quería ensayar despacio');
  advanceClock(14_000);
  assert.equal(session.getSnapshot().finalTranscript, '');
  assert.deepEqual(sent, []);
  delta('turn1', ' y luego volver a casa.');
  advanceClock(450);
  assert.deepEqual(sent, ['input_audio_buffer.commit']);
  assert.equal(session.getSnapshot().finalTranscript, '');
  final('turn1', lines.first);
  assert.equal(session.getSnapshot().finalTranscript, lines.first);
  assert.equal(await session.waitForInputEnd(), true);
  assert.equal(tracks[0].readyState, 'ended');

  setLine(true, 'second');
  await new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  assert.equal(connections, 1);
  assert.equal(session.getSnapshot().isAudioActive, true);
  assert.deepEqual(sent, ['input_audio_buffer.commit', 'input_audio_buffer.clear']);
  delta('turn1', 'evento tardío');
  assert.equal(session.getSnapshot().transcript, '');
  delta('turn2', lines.second);
  advanceClock(450);
  final('turn2', '');
  assert.equal(session.getSnapshot().finalTranscript, '');
  assert.equal(tracks[1].readyState, 'ended');
  session.stop();
  adapter.close();
  assert.equal(closed, 1);
});
