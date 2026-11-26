const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVoicePilotHandler } = require('../server/voice-pilot');

const code = 'ABC1-0012-3456-789A-BCDE-F012';
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const request = (method, supplied = code, body = { sdp: offer }) => ({ method, body, headers: { 'x-ai-theatre-pilot': supplied } });
const response = () => Object.assign(new EventEmitter(), {
  headers: {}, headersSent: false, writableEnded: false,
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
    storage, settings: () => ({ code, key: 'server-secret' }), now: () => 1000,
    connect: async (...args) => {
      connections.push(args);
      return { callId: `rtc_${connections.length}`, answer: 'v=0\r\n' };
    },
    disconnect: async (_key, callId) => { closed.push(callId); },
  };
  return { handler: createVoicePilotHandler(setup), stored, connections, closed, setup };
};

test('private pilot rejects missing codes and other origins before opening a provider connection', async () => {
  const f = fixture();
  const missing = response(), external = response();
  await f.handler(request('POST', 'wrong'), missing);
  await f.handler({ ...request('POST'), headers: { 'x-ai-theatre-pilot': code, 'sec-fetch-site': 'cross-site' } }, external);
  assert.equal(missing.statusCode, 403);
  assert.equal(external.statusCode, 403);
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
  assert.deepEqual(status.body, { remainingSeconds: 0, attemptSeconds: 45 });
});

test('private pilot reserves the entire window even after a lost response or failed setup', async () => {
  const f = fixture();
  const invalid = response(), failed = response();
  await f.handler(request('POST', code, { sdp: 'v=0' }), invalid);
  const broken = createVoicePilotHandler({ ...f.setup, connect: async () => { throw Error('sensitive response'); } });
  await broken(request('POST'), failed);
  assert.equal(invalid.statusCode, 400);
  assert.equal(failed.statusCode, 502);
  assert.equal(f.stored.size, 1);
  assert.equal(JSON.parse([...f.stored.values()][0]).reservedMs, 45_000);
  assert.doesNotMatch(JSON.stringify(failed.body), /sensitive response/);
});
