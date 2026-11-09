const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const originalFetch = global.fetch;
const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
const blobPath = require.resolve('@vercel/blob');
require(blobPath);
const originalBlob = require.cache[blobPath].exports;
const sharedPath = require.resolve('../api/shared-script/_shared');
const shared = require(sharedPath);
let folder, video, silentVideo, handler;
const writes = [], deletes = [];

before(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'teatro-video-test-'));
  const common = ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=32x32:r=1:d=1'];
  execFileSync(ffmpeg,[...common,'-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(folder,'voice.mp4')],{windowsHide:true});
  execFileSync(ffmpeg,[...common,'-c:v','libx264','-pix_fmt','yuv420p','-an',path.join(folder,'silent.mp4')],{windowsHide:true});
  video = fs.readFileSync(path.join(folder,'voice.mp4'));
  silentVideo = fs.readFileSync(path.join(folder,'silent.mp4'));
  process.env.BLOB_READ_WRITE_TOKEN = 'test-only';
  require.cache[blobPath].exports = { ...originalBlob,
    put: async (pathname, bytes, options) => { writes.push({pathname,bytes,options}); return {url:'https://example.com/converted.mp3',pathname}; },
    del: async (pathname) => { deletes.push(pathname); },
  };
  require.cache[sharedPath].exports = { ...shared,hasSongAdminPasswordConfigured:()=>true,isValidSongAdminPassword:value=>value==='test-only',isAuthorizedSongAdminRequest:(_request,value)=>value==='test-only',getStorageNamespace:()=> 'isolated-test' };
  handler = require('../api/shared-script/video-audio-extract');
  require.cache[sharedPath].exports = shared;
});
after(() => {
  global.fetch = originalFetch;
  require.cache[blobPath].exports = originalBlob;
  if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN=originalToken;
  // This directory is created above with a fixed prefix, never from user input.
  if (folder) { for (const name of ['voice.mp4','silent.mp4']) fs.unlinkSync(path.join(folder,name)); fs.rmdirSync(folder); }
});
const request = async (overrides={}) => {
  const response={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},setHeader(){}};
  await handler({method:'POST',body:{password:'test-only',shareId:'work',targetId:'cut',targetType:'musical-audition',sourceUrl:'https://example.com/video.mp4',sourcePathname:'test-source.mp4',sourceFileName:'grabacion.mp4',sourceContentType:'video/mp4',...overrides}},response);
  return response;
};

test('real video conversion produces playable MP3 in the correct folder for auditions and existing song targets', async () => {
  global.fetch = async () => new Response(video,{headers:{'Content-Length':String(video.length)}});
  for (const [targetType,targetFolder] of [['musical-audition','musical-auditions'],['musical-number','musical-numbers'],['song','songs']]) {
    const response=await request({targetType});
    assert.equal(response.statusCode,200);assert.equal(response.body.contentType,'audio/mpeg');assert.equal(response.body.fileName,'grabacion.mp3');
    const write=writes.at(-1);assert.ok(write.pathname.startsWith(`shared-scripts/isolated-test/work/${targetFolder}/cut/`));
    assert.equal(write.options.contentType,'audio/mpeg');assert.ok(write.bytes.length>1000);
    // Decode the actual conversion result, rather than merely trusting the MIME label.
    execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-f','null','-'],{input:write.bytes,windowsHide:true});
    assert.equal(deletes.at(-1),'test-source.mp4');
  }
});

test('a video without sound produces an actionable error and never replaces audio or deletes the source', async () => {
  global.fetch = async () => new Response(silentVideo);
  const writesBefore=writes.length,deletesBefore=deletes.length;
  const response=await request();
  assert.equal(response.statusCode,422);assert.match(response.body.error,/no contiene una pista de sonido/);
  assert.equal(writes.length,writesBefore);assert.equal(deletes.length,deletesBefore);
});

test('conversion rejects unauthenticated requests before reading or uploading any file', async () => {
  global.fetch = async () => { throw new Error('must not fetch'); };
  const writesBefore=writes.length;
  assert.equal((await request({password:''})).statusCode,401);assert.equal(writes.length,writesBefore);
});
