export const pilotEndpoint = '/api/shared-script?resource=voice-pilot';
export const pilotHeaders = code => ({ 'Content-Type': 'application/json', 'x-ai-theatre-pilot': code });
export const pilotError = async response => {
  const body = await response.json().catch(() => null);
  const detail = body?.provider;
  const suffix = detail?.status ? ` OpenAI indicó ${detail.status}${detail.code ? ` (${detail.code})` : ''}.` : '';
  return new Error((body?.error || 'No se pudo conectar con el ensayo privado.') + suffix);
};

const readAnswer = async response => {
  if (!response.ok) throw await pilotError(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('El iPhone no pudo leer la conexión de voz.');
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < 24_000) {
    const part = await reader.read();
    if (part.done) break;
    text += decoder.decode(part.value, { stream: true });
    const end = text.indexOf('\n\n');
    if (end !== -1 && text.startsWith('data: ')) return { reader, lease: JSON.parse(text.slice(6, end)) };
  }
  throw new Error('El servidor cerró la conexión antes de abrir la escucha.');
};

const waitForIce = peer => new Promise(resolve => {
  if (peer.iceGatheringState === 'complete') { resolve(); return; }
  const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
  const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
  const timer = setTimeout(finish, 1500);
  peer.addEventListener('icegatheringstatechange', changed);
});

export const openPilotConnection = async ({ code, output, signal, onEvent, onDisconnect }) => {
  const abort = new AbortController();
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel('oai-events');
  const session = { deadline: 0, remainingSeconds: 0, closed: false };
  let resolveReady, rejectReady, deadlineTimer;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const close = () => {
    if (session.closed) return;
    session.closed = true;
    clearTimeout(deadlineTimer);
    signal.removeEventListener('abort', close);
    abort.abort();
    peer.close();
    rejectReady(new Error('Se cerró la conexión de voz.'));
  };
  const dropped = message => {
    if (session.closed) return;
    close();
    onDisconnect(session, message);
  };
  session.close = close;
  session.send = type => {
    if (channel.readyState !== 'open') throw new Error('La conexión de voz se ha cerrado.');
    channel.send(JSON.stringify({ type }));
  };
  signal.addEventListener('abort', close, { once: true });
  channel.addEventListener('message', message => {
    let event;
    try { event = JSON.parse(message.data); } catch { dropped('La respuesta de OpenAI no era válida.'); return; }
    if (event.type === 'session.created' || event.type === 'transcription_session.created') {
      if (event.session?.type && event.session.type !== 'transcription') {
        dropped('OpenAI abrió una sesión distinta de la de transcripción.');
      } else resolveReady();
      return;
    }
    onEvent(session, event);
  });
  channel.addEventListener('close', () => dropped('Se cerró la conexión con OpenAI.'));
  peer.addEventListener('connectionstatechange', () => {
    if (['failed', 'disconnected'].includes(peer.connectionState)) dropped('Se interrumpió la conexión con OpenAI.');
  });
  const setupTimeout = setTimeout(() => dropped('OpenAI tardó demasiado en conectar.'), 21_000);
  try {
    if (signal.aborted) throw new Error('La conexión fue cancelada.');
    peer.addTrack(output.getAudioTracks()[0], output);
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    if (session.closed) throw new Error('Se cerró la conexión de voz.');
    const response = await fetch(pilotEndpoint, {
      method: 'POST', headers: pilotHeaders(code), signal: abort.signal,
      body: JSON.stringify({ rehearsal: true, sdp: peer.localDescription.sdp }),
    });
    const { reader, lease } = await readAnswer(response);
    if (!lease.answer || !Number.isFinite(lease.remainingMs) || lease.remainingMs < 1) throw new Error('El tiempo de este tramo no es válido.');
    session.deadline = performance.now() + lease.remainingMs;
    session.remainingSeconds = lease.remainingSeconds;
    deadlineTimer = setTimeout(() => dropped('Terminó el tramo de conexión.'), lease.remainingMs);
    void (async () => {
      try { while (!(await reader.read()).done) { /* The server keeps the lease open. */ } }
      catch { /* A cancelled stream is handled by the same cleanup. */ }
      dropped('Terminó el tramo de conexión.');
    })();
    await peer.setRemoteDescription({ type: 'answer', sdp: lease.answer });
    await ready;
    return session;
  } catch (error) {
    close();
    throw error;
  } finally { clearTimeout(setupTimeout); }
};
