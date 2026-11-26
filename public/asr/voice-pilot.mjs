const byId = id => document.getElementById(id);
const endpoint = '/api/shared-script?resource=voice-pilot';
const native = window.__AI_THEATRE_NATIVE_V1__;
const share = new URLSearchParams(location.search).get('share');
if (/^[a-z0-9-]{1,40}$/i.test(share || '')) byId('back').href = `/?share=${encodeURIComponent(share)}&nativePrototype=1`;

if (native?.platform === 'ios') {
  byId('unsupported').hidden = true;
  byId('pilot').hidden = false;
}

let code = '';
let available = 0;
let reservedPerAttempt = 45;
let active = null;
const status = (message, error = false) => {
  byId('status').textContent = message;
  byId('status').toggleAttribute('data-error', error);
};
const updateButtons = () => {
  byId('quota').textContent = `Tiempo sin reservar ${Math.floor(available / 60)} min ${available % 60} s. Cada intento reserva hasta ${reservedPerAttempt} s.`;
  byId('start').hidden = Boolean(active);
  byId('start').disabled = available <= 0;
  byId('repeat').hidden = active?.phase !== 'ready';
  byId('finish').hidden = active?.phase !== 'listening';
  byId('stop').hidden = !active;
};
const headers = () => ({ 'Content-Type': 'application/json', 'x-ai-theatre-pilot': code });
const readError = async response => {
  const body = await response.json().catch(() => null);
  const details = body?.provider;
  const suffix = details?.status ? ` OpenAI indicó ${details.status}${details.code ? ` (${details.code})` : ''}.` : '';
  return new Error((body?.error || 'No se pudo conectar con el piloto.') + suffix);
};
const refreshBudget = async () => {
  const response = await fetch(endpoint, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(7500) });
  if (!response.ok) throw await readError(response);
  const budget = await response.json();
  available = budget.remainingSeconds;
  reservedPerAttempt = budget.attemptSeconds;
  updateButtons();
};

byId('access').addEventListener('submit', async event => {
  event.preventDefault();
  if (native?.platform !== 'ios') return;
  code = byId('code').value.trim();
  byId('check').disabled = true;
  try {
    await refreshBudget();
    byId('code').value = '';
    byId('access').hidden = true;
    byId('controls').hidden = false;
    status('Acceso confirmado.');
  } catch (error) {
    status(error.message, true);
  } finally { byId('check').disabled = false; }
});

const release = (run, message, error = false) => {
  if (active !== run) return;
  active = null;
  clearTimeout(run.deadlineTimer);
  clearTimeout(run.resultTimer);
  cancelAnimationFrame(run.meter);
  run.abort.abort();
  try { run.voice?.stop(); } catch { /* The cue may already have ended. */ }
  run.peer?.close();
  for (const track of run.stream?.getTracks() ?? []) track.stop();
  for (const track of run.output?.stream.getTracks() ?? []) track.stop();
  if (run.audio?.state !== 'closed') void run.audio?.close().catch(() => {});
  if (run.oldAudioType !== undefined) {
    try { navigator.audioSession.type = run.oldAudioType; } catch { /* The device may be switching outputs. */ }
  }
  updateButtons();
  status(message, error);
  if (run.requested) void refreshBudget().catch(() => {});
};

const firstEvent = async response => {
  if (!response.ok) throw await readError(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('El iPhone no pudo leer los datos de conexión.');
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < 24_000) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    const end = text.indexOf('\n\n');
    if (end !== -1 && text.startsWith('data: ')) return { reader, value: JSON.parse(text.slice(6, end)) };
  }
  throw new Error('El servidor no entregó la conexión de voz.');
};

const waitForIce = peer => new Promise(resolve => {
  if (peer.iceGatheringState === 'complete') { resolve(); return; }
  const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
  const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
  const timer = setTimeout(finish, 1500);
  peer.addEventListener('icegatheringstatechange', changed);
});

const watchConnection = async (run, reader) => {
  try {
    while (!(await reader.read()).done) { /* The connection stays open until the server closes the session. */ }
    release(run, 'Se cerró el intento. Puedes iniciar otro si queda tiempo.');
  } catch {
    release(run, 'La conexión se interrumpió. Puedes iniciar otro intento.', true);
  }
};

const timing = turn => {
  if (!turn.firstText) return '';
  if (!turn.firstSignal) return 'Ya hay texto. No se detectó un inicio de voz claro para medirlo.';
  return `Primer texto ${Math.max(0, turn.firstText - turn.firstSignal).toFixed(0)} ms después de la primera señal de voz estimada.`;
};
const monitor = run => {
  if (active !== run || run.phase !== 'listening') return;
  run.analyser.getFloatTimeDomainData(run.levels);
  const rms = Math.sqrt(run.levels.reduce((sum, value) => sum + value * value, 0) / run.levels.length);
  if (!run.turn.firstSignal && rms > 0.025) {
    run.turn.firstSignal = performance.now();
    byId('timing').textContent = timing(run.turn);
  }
  run.meter = requestAnimationFrame(() => monitor(run));
};

const playCue = run => {
  if (active !== run || run.phase !== 'ready') return;
  if (performance.now() + 6000 > run.deadline) {
    release(run, 'Queda poco tiempo en este intento. Inicia otro para probar una réplica completa.');
    return;
  }
  run.phase = 'cue';
  run.turn = { item: null, text: '', firstSignal: 0, firstText: 0 };
  byId('result').hidden = false;
  byId('words').textContent = '';
  byId('timing').textContent = '';
  status('Escucha a la otra voz…');
  updateButtons();
  const voice = run.audio.createBufferSource();
  run.voice = voice;
  voice.buffer = run.cue;
  voice.connect(run.audio.destination);
  const startsAt = run.audio.currentTime + 0.055;
  const endsAt = startsAt + run.cue.duration;
  run.gate.gain.setValueAtTime(0, run.audio.currentTime);
  run.gate.gain.setValueAtTime(1, endsAt);
  voice.onended = () => {
    if (active !== run || run.voice !== voice) return;
    run.voice = null;
    run.phase = 'listening';
    status('Tu turno. Empieza a hablar.');
    updateButtons();
    monitor(run);
  };
  voice.start(startsAt);
};

const handleEvent = (run, event) => {
  if (active !== run) return;
  if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
    const label = event.error?.code;
    const detail = typeof label === 'string' && /^[a-z0-9_-]{1,80}$/i.test(label) ? ` (${label})` : '';
    release(run, `OpenAI no pudo completar la escucha${detail}.`, true);
    return;
  }
  if (event.type === 'session.created' || event.type === 'transcription_session.created') {
    if (run.phase !== 'connecting') return;
    if (event.session?.type && event.session.type !== 'transcription') {
      release(run, 'El servicio abrió una sesión distinta de la de transcripción.', true);
      return;
    }
    run.phase = 'ready';
    updateButtons();
    playCue(run);
    return;
  }
  if (!['listening', 'finishing'].includes(run.phase) || !event.item_id || run.retired.has(event.item_id)) return;
  const turn = run.turn;
  if (turn.item && turn.item !== event.item_id) return;
  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    if (typeof event.delta !== 'string' || !event.delta) return;
    turn.item = event.item_id;
    turn.text += event.delta;
    if (turn.text.trim()) turn.firstText ||= performance.now();
    byId('words').textContent = turn.text;
    byId('timing').textContent = timing(turn);
  } else if (event.type === 'conversation.item.input_audio_transcription.completed' && run.phase === 'finishing') {
    clearTimeout(run.resultTimer);
    run.retired.add(event.item_id);
    byId('words').textContent = event.transcript?.trim() || 'OpenAI no devolvió palabras en este turno.';
    byId('timing').textContent = timing(turn);
    run.phase = 'ready';
    status(event.transcript?.trim() ? 'Réplica terminada. Comprueba si entró la primera palabra.' : 'Réplica sin texto. Puedes probar otra.', !event.transcript?.trim());
    updateButtons();
  }
};

const start = async () => {
  if (active || available <= 0 || native?.platform !== 'ios' || !native.foreground || document.hidden) return;
  const run = { phase: 'connecting', abort: new AbortController(), retired: new Set() };
  active = run;
  status('Preparando el micrófono y la conexión…');
  updateButtons();
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
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => release(run, 'El iPhone cerró la entrada del micrófono.', true)));
    const cue = await fetch('/audio/voice-pilot-cue.mp3', { signal: run.abort.signal });
    if (!cue.ok) throw new Error('No se pudo preparar la voz del personaje.');
    run.cue = await run.audio.decodeAudioData(await cue.arrayBuffer());
    if (active !== run) return;
    const input = run.audio.createMediaStreamSource(stream);
    run.analyser = run.audio.createAnalyser();
    run.levels = new Float32Array(run.analyser.fftSize);
    run.gate = run.audio.createGain();
    run.gate.gain.value = 0;
    run.output = run.audio.createMediaStreamDestination();
    input.connect(run.analyser);
    run.analyser.connect(run.gate).connect(run.output);
    const peer = run.peer = new RTCPeerConnection();
    peer.addTrack(run.output.stream.getAudioTracks()[0], run.output.stream);
    const channel = run.channel = peer.createDataChannel('oai-events');
    channel.addEventListener('message', message => {
      try { handleEvent(run, JSON.parse(message.data)); } catch { release(run, 'Llegó una respuesta de voz que no se pudo leer.', true); }
    });
    channel.addEventListener('close', () => release(run, 'Terminó la conexión con OpenAI.'));
    peer.addEventListener('connectionstatechange', () => {
      if (['failed', 'disconnected'].includes(peer.connectionState)) release(run, 'Se perdió la conexión de voz. Puedes iniciar otro intento.', true);
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    if (active !== run) return;
    run.requested = true;
    run.deadlineTimer = setTimeout(() => release(run, 'La conexión tardó demasiado en abrirse.', true), 22_000);
    const response = await fetch(endpoint, {
      method: 'POST', headers: headers(), body: JSON.stringify({ sdp: peer.localDescription.sdp }), signal: run.abort.signal,
    });
    const { reader, value } = await firstEvent(response);
    if (active !== run) return;
    available = value.remainingSeconds;
    run.deadline = performance.now() + value.remainingMs;
    clearTimeout(run.deadlineTimer);
    run.deadlineTimer = setTimeout(() => release(run, 'Se agotó el tiempo reservado para este intento.'), value.remainingMs);
    updateButtons();
    void watchConnection(run, reader);
    await peer.setRemoteDescription({ type: 'answer', sdp: value.answer });
  } catch (error) {
    release(run, error.name === 'NotAllowedError' ? 'El iPhone requiere permiso de micrófono para probar la voz.' : error.message, true);
  }
};

byId('start').addEventListener('click', () => void start());
byId('repeat').addEventListener('click', () => { if (active) playCue(active); });
byId('stop').addEventListener('click', () => { if (active) release(active, 'Prueba detenida.'); });
byId('finish').addEventListener('click', () => {
  const run = active;
  if (run?.phase !== 'listening' || run.channel.readyState !== 'open') return;
  run.phase = 'finishing';
  run.gate.gain.setValueAtTime(0, run.audio.currentTime);
  cancelAnimationFrame(run.meter);
  run.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  run.resultTimer = setTimeout(() => release(run, 'OpenAI no confirmó la réplica. Puedes iniciar otro intento.', true), 4500);
  status('Recibiendo el final de la réplica…');
  updateButtons();
});
const stopOnHide = () => {
  if (active && (document.hidden || !native?.foreground)) release(active, 'Prueba detenida al dejar el ensayo.');
};
document.addEventListener('visibilitychange', stopOnHide);
window.addEventListener('ai-theatre-native-visibility', stopOnHide);
window.addEventListener('pagehide', () => { if (active) release(active, 'Prueba detenida.'); });
