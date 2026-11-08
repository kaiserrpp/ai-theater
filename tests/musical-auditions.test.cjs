const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMusicalAuditions } = require('../shared/musicalAuditions');
const sharedPath = require.resolve('../api/shared-script/_shared');
const shared = require(sharedPath);
const oldToken = process.env.BLOB_READ_WRITE_TOKEN;
before(() => { process.env.BLOB_READ_WRITE_TOKEN = 'test-only'; });
after(() => { if (oldToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = oldToken; });

const base = () => shared.normalizeManifest({ shareId: 'music-test', scriptData: { obra: 'Obra', personajes: ['ANA','LUIS'], guion: [{p:'ANA',t:'Hola.'}] },
  musicalNumbers: [{id:'original-number',title:'Canción completa',startLineIndex:-1,endLineIndex:-1,songIds:[],audios:[{id:'complete',kind:'karaoke',audioUrl:'https://example.com/complete.mp3'}]}],
  auditionScenes: [{id:'spoken',title:'Escena',revision:1,scriptData:{obra:'Escena',guion:[{p:'ANA',t:'Hola.'}]}}] });
const setup = (manifest = base()) => {
  let current = structuredClone(manifest), writes = 0;
  const original = require.cache[sharedPath];
  require.cache[sharedPath] = { ...original, exports: { ...shared,
    hasSongAdminPasswordConfigured: () => true, isValidSongAdminPassword: (password) => password === 'test-key',
    readManifest: async () => structuredClone(current),
    writeManifest: async (value) => { writes++; current = shared.normalizeManifest(value); return structuredClone(current); },
  }};
  const handlers = Object.fromEntries(['musical-audition','publish','musical-number','audition-scene'].map((file) => {
    const path = require.resolve(`../api/shared-script/${file}`); delete require.cache[path]; return [file,require(path)];
  }));
  require.cache[sharedPath] = original;
  return { current: () => current, writes: () => writes,
    request: async (method, body, name = 'musical-audition') => {
      const response = { statusCode:200, setHeader(){}, status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;} };
      await handlers[name]({method,body,headers:{host:'localhost'}},response); return response;
    },
  };
};
const input = (auditionId = 'musical-audition-one') => ({shareId:'music-test',password:'test-key',auditionId,musicalNumberTitle:'Nuevo número',title:'Fragmento de Ana',roles:['ANA'],lyrics:'Mi letra'});
const audio = (kind, revision = 1) => ({shareId:'music-test',password:'test-key',auditionId:'musical-audition-one',revision,operation:'audio',kind,
  audio:{audioUrl:`https://example.com/${kind}.m4a`,audioFileName:`${kind}.m4a`,contentType:'audio/mp4',size:1000}});

test('old works receive an empty audition music collection and both existing music and scenes survive normalization', () => {
  const value=base(); assert.equal(value.version,6); assert.deepEqual(value.musicalAuditions,[]);
  assert.equal(value.musicalNumbers[0].audios[0].audioUrl,'https://example.com/complete.mp3');
  assert.equal(value.auditionScenes.length,1);
});
test('create a fragment and unlinked parent even when the work already has a script; save without audio and complete later', async () => {
  const api=setup(), previous=api.current();
  assert.equal((await api.request('POST',input())).statusCode,200);
  const cut=api.current().musicalAuditions[0]; assert.deepEqual(cut.audios,[]);
  assert.ok(api.current().musicalNumbers.some((number)=>number.id===cut.musicalNumberId && number.startLineIndex===-1));
  assert.deepEqual(api.current().scriptData,previous.scriptData); assert.deepEqual(api.current().auditionScenes,previous.auditionScenes);
  assert.deepEqual(api.current().musicalNumbers[0],previous.musicalNumbers[0]);
});
test('a repeated create after a lost response is idempotent and does not create another parent or fragment', async () => {
  const api=setup(); await api.request('POST',input()); const saved=structuredClone(api.current());
  assert.equal((await api.request('POST',input())).statusCode,200); assert.deepEqual(api.current(),saved); assert.equal(api.writes(),1);
});
test('several fragments can belong to one number and keep independent roles, lyrics, audio and revision', async () => {
  const api=setup(); await api.request('POST',{...input(),musicalNumberId:'original-number'});
  await api.request('POST',{...input('musical-audition-two'),musicalNumberId:'original-number',title:'Fragmento de Luis',roles:['LUIS']});
  assert.equal((await api.request('PATCH',audio('vocal_guide'))).statusCode,200);
  assert.equal((await api.request('PATCH',audio('karaoke',2))).statusCode,200);
  const [first,second]=api.current().musicalAuditions;
  assert.deepEqual(first.audios.map(value=>value.kind),['vocal_guide','karaoke']);
  assert.equal(second.revision,1); assert.deepEqual(second.roles,['LUIS']); assert.deepEqual(second.audios,[]);
  assert.equal(api.current().musicalNumbers[0].audios[0].id,'complete');
});
test('replacing or removing one audio keeps the other slot and the full song unchanged', async () => {
  const api=setup(); await api.request('POST',input()); await api.request('PATCH',audio('vocal_guide')); await api.request('PATCH',audio('karaoke',2));
  const replaced=audio('vocal_guide',3); replaced.audio.audioUrl='https://example.com/replaced.mp3';
  await api.request('PATCH',replaced); assert.equal(api.current().musicalAuditions[0].audios.length,2);
  await api.request('PATCH',{...audio('karaoke',4),operation:'remove-audio'});
  assert.equal(api.current().musicalAuditions[0].audios[0].audioUrl,'https://example.com/replaced.mp3');
  assert.equal(api.current().musicalNumbers[0].audios[0].audioUrl,'https://example.com/complete.mp3');
});
test('stale updates and deletes cannot overwrite newer fragment edits or audio uploads', async () => {
  const api=setup(); await api.request('POST',input()); await api.request('PATCH',audio('vocal_guide'));
  const writes=api.writes();
  for(const [method,body] of [['PATCH',{...input(),revision:1}],['PATCH',audio('karaoke',1)],['DELETE',{...input(),revision:1}]]) assert.equal((await api.request(method,body)).statusCode,409);
  assert.equal(api.writes(),writes); assert.equal(api.current().musicalAuditions[0].audios.length,1);
});
test('invalid roles, kinds, links, file sizes, missing parents and unauthenticated writes never save', async () => {
  const api=setup();
  for(const payload of [{...input(),password:''},{...input(),roles:[]},{...input(),title:''},{...input(),musicalNumberId:'missing'}, {...input(),lyrics:12}]) assert.ok((await api.request('POST',payload)).statusCode>=400);
  assert.equal(api.writes(),0); await api.request('POST',input()); const writes=api.writes();
  for(const payload of [{...audio('other')}, {...audio('karaoke'),audio:{audioUrl:'javascript:alert(1)'}},{...audio('karaoke'),audio:{audioUrl:'https://example.com/a',size:-1}},{...audio('karaoke'),operation:'unknown'}]) assert.equal((await api.request('PATCH',payload)).statusCode,400);
  assert.equal((await api.request('DELETE',{...input(),password:'',revision:1})).statusCode,401); assert.equal(api.writes(),writes);
});
test('republishing from an older client preserves the audition collection and its parent missing from that payload', async () => {
  const api=setup(); await api.request('POST',input()); await api.request('PATCH',audio('vocal_guide'));
  const saved=structuredClone(api.current());
  const result=await api.request('POST',{shareId:'music-test',password:'test-key',scriptData:base().scriptData,songs:[],musicalNumbers:base().musicalNumbers},'publish');
  assert.equal(result.statusCode,200); assert.deepEqual(api.current().musicalAuditions,saved.musicalAuditions);
  assert.ok(api.current().musicalNumbers.some(number=>number.id===saved.musicalAuditions[0].musicalNumberId));
});
test('parent deletion is rejected while used, and deleting one fragment retains siblings and its parent', async () => {
  const api=setup(); await api.request('POST',{...input(),musicalNumberId:'original-number'}); await api.request('POST',{...input('musical-audition-two'),musicalNumberId:'original-number'});
  assert.equal((await api.request('DELETE',{shareId:'music-test',password:'test-key',musicalNumberId:'original-number'},'musical-number')).statusCode,409);
  assert.equal((await api.request('DELETE',{...input(),revision:1})).statusCode,200);
  assert.equal(api.current().musicalAuditions.length,1); assert.equal(api.current().musicalAuditions[0].id,'musical-audition-two'); assert.ok(api.current().musicalNumbers.some(value=>value.id==='original-number'));
});
test('normalization deduplicates roles and slots without treating a full song as an audition', () => {
  const values=normalizeMusicalAuditions([{...input(),id:'cut',musicalNumberId:'parent',roles:[' ANA ','ana','LUIS'],audios:[{...audio('karaoke').audio,kind:'karaoke'},{...audio('karaoke').audio,kind:'karaoke'}]}]);
  assert.deepEqual(values[0].roles,['ANA','LUIS']); assert.equal(values[0].audios.length,1);
  assert.deepEqual(normalizeMusicalAuditions([{id:'cut',title:'Song',musicalNumberId:'parent',roles:[]}]),[]);
});
