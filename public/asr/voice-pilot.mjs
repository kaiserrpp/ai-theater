import { pilotEndpoint, pilotHeaders, pilotError, openPilotConnection } from './voice-pilot-connection.mjs';
import { hasCompleteLiveLine } from './voice-pilot-ending.mjs';

const $ = id => document.getElementById(id);
const native = window.__AI_THEATRE_NATIVE_V1__;
const params = new URLSearchParams(location.search);
const rawShare = params.get('share');
const share = /^[a-z0-9-]{1,40}$/i.test(rawShare || '') ? rawShare : 'd92b33981047';
$('back').href = `/?share=${encodeURIComponent(share)}&nativePrototype=1`;

if (native?.platform === 'ios') {
  $('unsupported').hidden = true;
  $('pilot').hidden = false;
}

let code = '', budget = 0, scripts = [], rehearsal = null, active = null;
const status = (text, error = false) => {
  $('status').textContent = text;
  $('status').toggleAttribute('data-error', error);
};
const updateBudget = seconds => {
  budget = seconds;
  $('quota').textContent = `Tiempo por reservar ${Math.floor(budget / 60)} min ${budget % 60} s. Cada conexión reserva hasta 3 min.`;
  $('quota').hidden = false;
  $('begin').disabled = !$('scene').value || budget === 0;
  $('resume').disabled = budget === 0;
};
const readBudget = async () => {
  const response = await fetch(pilotEndpoint, { headers: pilotHeaders(code), cache: 'no-store', signal: AbortSignal.timeout(7500) });
  if (!response.ok) throw await pilotError(response);
  updateBudget((await response.json()).remainingSeconds);
};
const readAuditionScenes = audition => {
  const scenes = [];
  let current = { id: 0, title: audition.title, lines: [] };
  audition.scriptData.guion.forEach((line, index) => {
    if (line.p === 'ESCENA_SISTEMA') {
      if (current.lines.length) scenes.push(current);
      current = { id: index, title: line.t, lines: [] };
      return;
    }
    if (line.p === 'CANCION_SISTEMA' || line.k === 'song') return;
    const spoken = line.t?.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spoken) return;
    current.lines.push({ index, role: line.p, roles: Array.isArray(line.r) && line.r.length ? line.r : [line.p],
      text: line.t, spoken, direction: line.a });
  });
  if (current.lines.length) scenes.push(current);
  return scenes;
};
const options = (select, items, selected) => {
  select.replaceChildren(...items.map(item => new Option(item.label, item.value)));
  if (items.some(item => item.value === selected)) select.value = selected;
};
const selectedScript = () => scripts.find(audition => audition.id === $('script').value);
const chooseScene = preferred => {
  const audition = selectedScript();
  const scenes = audition?.scenes.filter(scene => scene.lines.some(line => line.roles.includes($('role').value))) ?? [];
  options($('scene'), scenes.map(scene => ({ value: String(scene.id), label: scene.title })), preferred);
  $('begin').disabled = !scenes.length || budget === 0;
};
const chooseRole = preferred => {
  const roles = [...new Set(selectedScript()?.scenes.flatMap(scene => scene.lines.flatMap(line => line.roles)) ?? [])];
  options($('role'), roles.map(role => ({ value: role, label: role })), preferred);
  chooseScene();
};

$('access').addEventListener('submit', async event => {
  event.preventDefault();
  if (native?.platform !== 'ios') return;
  code = $('code').value.trim();
  $('check').disabled = true;
  try {
    await readBudget();
    const response = await fetch(`/api/shared-script?shareId=${encodeURIComponent(share)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('No se pudo abrir el miniguion de esta obra.');
    const manifest = await response.json();
    scripts = (manifest.auditionScenes ?? []).map(audition => ({ ...audition, scenes: readAuditionScenes(audition) }))
      .filter(audition => audition.scenes.length);
    if (!scripts.length) throw new Error('Esta obra no tiene miniguiones con escenas para el ensayo privado.');
    options($('script'), scripts.map(audition => ({ value: audition.id, label: audition.title })));
    chooseRole(params.get('role'));
    $('access').hidden = true;
    $('code').value = '';
    $('setup').hidden = false;
    status(budget ? 'Elige tu personaje y una escena.' : 'Se agotó el tiempo del ensayo privado.');
  } catch (error) {
    status(error.message, true);
  } finally { $('check').disabled = false; }
});
$('script').addEventListener('change', () => chooseRole($('role').value));
$('role').addEventListener('change', () => chooseScene($('scene').value));

const current = () => rehearsal?.scene.lines[rehearsal.index];
const isMine = line => line?.roles.includes(rehearsal.role);
const showLine = () => {
  const line = current();
  $('position').textContent = `${rehearsal.scene.title} · ${Math.min(rehearsal.index + 1, rehearsal.scene.lines.length)} de ${rehearsal.scene.lines.length}`;
  $('character').textContent = line?.role || 'Escena terminada';
  $('direction').textContent = line?.direction || '';
  $('direction').hidden = !line?.direction;
  $('line').textContent = line?.text || '';
  $('dialogue').toggleAttribute('data-actor', Boolean(isMine(line)));
  $('transcript').hidden = !isMine(line);
  $('heard').textContent = '';
  $('timing').textContent = '';
};
const showControls = () => {
  const phase = active?.phase;
  $('pause').hidden = !active;
  $('resume').hidden = Boolean(active) || !current();
  $('resume').disabled = budget === 0;
  $('retry').hidden = !['actor', 'repeat'].includes(phase);
  $('skip').hidden = !current();
  $('skip').disabled = Boolean(active) && !['actor', 'other', 'repeat'].includes(phase);
};
const mute = run => {
  if (!run.gate) return;
  const time = run.audio.currentTime;
  run.gate.gain.cancelScheduledValues(time);
  run.gate.gain.setValueAtTime(0, time);
};
const stopCurrent = run => {
  mute(run);
  cancelAnimationFrame(run.meter);
  clearTimeout(run.resultTimer);
  if (run.turn?.item) run.retired.add(run.turn.item);
  run.turn = null;
  const player = run.player;
  run.player = null;
  try { player?.stop(); } catch { /* It may already have ended. */ }
};
const pause = (run, message, error = false) => {
  if (active !== run) return;
  stopCurrent(run);
  active = null;
  run.abort.abort();
  run.link?.close();
  for (const track of run.stream?.getTracks() ?? []) track.stop();
  for (const track of run.output?.stream.getTracks() ?? []) track.stop();
  if (run.audio?.state !== 'closed') void run.audio?.close().catch(() => {});
  if (run.oldAudioType !== undefined) {
    try { navigator.audioSession.type = run.oldAudioType; } catch { /* The route may be switching. */ }
  }
  showControls();
  status(message, error);
  if (run.connectionRequested) void readBudget().catch(() => {});
};

const changePhase = (run, phase) => {
  run.phase = phase;
  showControls();
};
const timing = turn => {
  if (!turn.firstText || !turn.firstVoice) return '';
  return `Primer texto ${Math.max(0, turn.firstText - turn.firstVoice).toFixed(0)} ms después de la primera señal de voz estimada.`;
};
const finishTurn = (run, turn) => {
  if (active !== run || run.turn !== turn || run.phase !== 'actor') return;
  mute(run);
  cancelAnimationFrame(run.meter);
  changePhase(run, 'confirming');
  status('Comprobando el final de tu réplica…');
  try { run.link.send('input_audio_buffer.commit'); }
  catch (error) { pause(run, error.message, true); return; }
  run.resultTimer = setTimeout(() => {
    if (active === run && run.turn === turn) pause(run, 'OpenAI no confirmó el final. Puedes reanudar desde esta réplica.', true);
  }, 4500);
};
const monitor = (run, turn) => {
  if (active !== run || run.phase !== 'actor' || run.turn !== turn) return;
  const now = performance.now();
  run.analyser.getFloatTimeDomainData(run.levels);
  const rms = Math.sqrt(run.levels.reduce((total, value) => total + value * value, 0) / run.levels.length);
  if (rms > 0.017) {
    turn.firstVoice ||= now;
    turn.lastVoice = now;
  }
  if (turn.complete && now - Math.max(turn.lastVoice, turn.lastWord) >= 400) {
    finishTurn(run, turn);
    return;
  }
  if (!turn.firstText && turn.firstVoice && now - turn.firstVoice >= 4500 && !turn.warned) {
    turn.warned = true;
    status('El micrófono detecta voz. OpenAI todavía no ha devuelto palabras.', true);
  }
  run.meter = requestAnimationFrame(() => monitor(run, turn));
};
const actorTurn = (run, gateAlreadyScheduled = false) => {
  if (active !== run) return;
  showLine();
  run.turn = { item: null, text: '', firstVoice: 0, lastVoice: 0, firstText: 0, lastWord: 0, complete: false };
  run.bufferDirty = true;
  if (!gateAlreadyScheduled) run.gate.gain.setValueAtTime(1, run.audio.currentTime);
  changePhase(run, 'actor');
  status('Tu turno.');
  monitor(run, run.turn);
};

const onProviderEvent = (run, link, event) => {
  if (active !== run || run.link !== link) return;
  if (event.type === 'input_audio_buffer.cleared') { run.clearDone?.(); return; }
  if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
    pause(run, 'OpenAI interrumpió la escucha. Puedes reanudar en esta línea.', true);
    return;
  }
  const turn = run.turn;
  if (!turn || !event.item_id || run.retired.has(event.item_id) || (turn.item && turn.item !== event.item_id)) return;
  if (event.type === 'conversation.item.input_audio_transcription.delta' && ['actor', 'confirming'].includes(run.phase)) {
    if (!event.delta || typeof event.delta !== 'string') return;
    turn.item = event.item_id;
    turn.text += event.delta;
    if (turn.text.trim()) {
      turn.firstText ||= performance.now();
      turn.lastWord = performance.now();
      turn.complete = hasCompleteLiveLine(current().spoken, turn.text);
      if (turn.warned && run.phase === 'actor') status('Tu turno.');
    }
    $('heard').textContent = turn.text;
    $('timing').textContent = timing(turn);
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed' && run.phase === 'confirming') {
    clearTimeout(run.resultTimer);
    run.retired.add(event.item_id);
    run.bufferDirty = false;
    const result = typeof event.transcript === 'string' ? event.transcript.trim() : '';
    $('heard').textContent = result;
    if (result && hasCompleteLiveLine(current().spoken, result)) {
      rehearsal.index += 1;
      void drive(run);
    } else {
      changePhase(run, 'repeat');
      status('La transcripción final no confirmó el cierre. Puedes repetir o pasar la línea.', true);
    }
  }
};

const ensureLink = async (run, minimumMs) => {
  if (run.link && !run.link.closed && run.link.deadline - performance.now() >= minimumMs) return;
  if (!budget) {
    if (run.link && !run.link.closed && run.link.deadline - performance.now() > 6500) return;
    throw new Error('Se agotó el tiempo del ensayo privado.');
  }
  run.link?.close();
  run.link = null;
  run.retired.clear();
  run.bufferDirty = false;
  run.connectionRequested = true;
  status('Conectando la escucha de OpenAI…');
  const link = await openPilotConnection({
    code, output: run.output.stream, signal: run.abort.signal,
    onEvent: (connection, event) => onProviderEvent(run, connection, event),
    onDisconnect: (connection, message) => {
      if (active === run && run.link === connection) pause(run, `${message} Puedes reanudar desde esta línea.`, true);
    },
  });
  if (active !== run) { link.close(); return; }
  run.link = link;
  updateBudget(link.remainingSeconds);
};

const drive = async run => {
  if (active !== run) return;
  stopCurrent(run);
  showLine();
  const line = current();
  if (!line) { pause(run, 'Escena terminada. Puedes elegir otra.'); return; }
  changePhase(run, 'opening');
  try {
    const next = rehearsal.scene.lines[rehearsal.index + 1];
    const userLine = isMine(line) ? line : isMine(next) ? next : null;
    const buffer = isMine(line) ? null : run.clips.get(line.index);
    if (userLine) {
      const speechMs = userLine.spoken.split(/\s+/).length * 450;
      const waitMs = (buffer?.duration ?? 0) * 1000 + Math.min(64_000, 24_000 + speechMs);
      await ensureLink(run, waitMs);
      if (active !== run) return;
    }
    if (isMine(line)) { actorTurn(run); return; }
    changePhase(run, 'other');
    status('Escucha al otro personaje.');
    const player = run.audio.createBufferSource();
    run.player = player;
    player.buffer = buffer;
    player.connect(run.audio.destination);
    const startAt = run.audio.currentTime + 0.025;
    if (userLine) run.gate.gain.setValueAtTime(1, startAt + buffer.duration);
    player.onended = () => {
      if (active !== run || run.player !== player) return;
      run.player = null;
      rehearsal.index += 1;
      if (userLine) actorTurn(run, true);
      else void drive(run);
    };
    player.start(startAt);
  } catch (error) { pause(run, error.message, true); }
};

const start = async () => {
  if (!current() || active || !budget || !native?.foreground || document.hidden) return;
  const run = { phase: 'opening', abort: new AbortController(), retired: new Set(), clips: new Map() };
  active = run;
  $('setup').hidden = true;
  $('dialogue').hidden = false;
  showLine();
  showControls();
  status('Preparando las voces de la escena…');
  try {
    if (navigator.audioSession) {
      run.oldAudioType = navigator.audioSession.type;
      navigator.audioSession.type = 'play-and-record';
    }
    run.audio = new AudioContext();
    await run.audio.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (active !== run) { stream.getTracks().forEach(track => track.stop()); return; }
    run.stream = stream;
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => pause(run, 'El iPhone cerró la entrada del micrófono.', true)));
    if (!rehearsal.pack) {
      const query = new URLSearchParams({ action: 'voice-pack', share, audition: rehearsal.audition.id,
        revision: String(rehearsal.audition.revision), scene: String(rehearsal.scene.id) });
      const response = await fetch(`${pilotEndpoint}&${query}`, {
        headers: pilotHeaders(code), cache: 'no-store', signal: run.abort.signal,
      });
      if (!response.ok) throw await pilotError(response);
      const pack = await response.json();
      if (active !== run) return;
      rehearsal.pack = pack.clips;
    }
    await Promise.all(rehearsal.scene.lines.filter(line => !isMine(line)).map(async line => {
      const raw = rehearsal.pack?.[line.index];
      if (!raw) throw new Error('Falta la voz de un personaje para esta escena.');
      const data = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
      run.clips.set(line.index, await run.audio.decodeAudioData(data.buffer));
    }));
    if (active !== run) return;
    const input = run.audio.createMediaStreamSource(stream);
    run.analyser = run.audio.createAnalyser();
    run.levels = new Float32Array(run.analyser.fftSize);
    run.gate = run.audio.createGain();
    run.gate.gain.value = 0;
    run.output = run.audio.createMediaStreamDestination();
    input.connect(run.analyser);
    run.analyser.connect(run.gate).connect(run.output);
    void drive(run);
  } catch (error) {
    pause(run, error.name === 'NotAllowedError' ? 'El iPhone necesita permiso de micrófono para ensayar.' : error.message, true);
  }
};
const clearTurn = async run => {
  if (!run.bufferDirty || !run.link || run.link.closed) return;
  await new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer);
      run.clearDone = null;
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => done(new Error('OpenAI no confirmó el reinicio de la réplica.')), 1700);
    run.clearDone = () => done();
    try { run.link.send('input_audio_buffer.clear'); } catch (error) { done(error); }
  });
  run.bufferDirty = false;
};
const move = async skip => {
  if (!current()) return;
  const run = active;
  if (!run) { if (skip) rehearsal.index += 1; showLine(); showControls(); return; }
  if (!['actor', 'other', 'repeat'].includes(run.phase)) return;
  // During the last other voice the microphone gate may already be scheduled.
  stopCurrent(run);
  changePhase(run, 'opening');
  try {
    await clearTurn(run);
    if (active !== run) return;
    if (skip) rehearsal.index += 1;
    void drive(run);
  } catch (error) { pause(run, error.message, true); }
};

$('begin').addEventListener('click', () => {
  const audition = selectedScript();
  const scene = audition?.scenes.find(scene => String(scene.id) === $('scene').value);
  if (!scene) return;
  rehearsal = { audition, scene, role: $('role').value, index: 0, pack: null };
  void start();
});
$('pause').addEventListener('click', () => { if (active) pause(active, 'Ensayo en pausa.'); });
$('resume').addEventListener('click', () => void start());
$('retry').addEventListener('click', () => void move(false));
$('skip').addEventListener('click', () => void move(true));
$('leave').addEventListener('click', () => {
  if (active) pause(active, 'Elige una escena.');
  rehearsal = null;
  $('dialogue').hidden = true;
  $('setup').hidden = false;
  status('Elige tu personaje y una escena.');
});
const stopOnHide = () => {
  if (active && (document.hidden || !native?.foreground)) pause(active, 'Ensayo en pausa al dejar la app.');
};
document.addEventListener('visibilitychange', stopOnHide);
window.addEventListener('ai-theatre-native-visibility', stopOnHide);
window.addEventListener('pagehide', () => { if (active) pause(active, 'Ensayo en pausa.'); });
