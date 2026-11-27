const endpoint = '/api/shared-script?resource=voice-pilot';

export const supportsOpenAiRecognition = () => typeof window !== 'undefined' &&
  typeof window.RTCPeerConnection === 'function' && typeof window.AudioContext === 'function' &&
  typeof window.navigator.mediaDevices?.getUserMedia === 'function';

export class OpenAiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type OpenAiVoiceEvent = { type: string; item_id?: string; delta?: string; transcript?: string };
export type OpenAiVoiceConnection = {
  deadline: number;
  remainingSeconds: number;
  close: () => void;
  send: (type: 'input_audio_buffer.clear' | 'input_audio_buffer.commit') => void;
};

const readAnswer = async (response: Response) => {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new OpenAiRequestError(response.status, body?.error || 'No se pudo abrir la escucha de OpenAI.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Este dispositivo no pudo leer la conexión de voz.');
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < 24_000) {
    const part = await reader.read();
    if (part.done) break;
    text += decoder.decode(part.value, { stream: true });
    const end = text.indexOf('\n\n');
    if (end >= 0 && text.startsWith('data: ')) {
      const { answer, remainingMs, remainingSeconds } = JSON.parse(text.slice(6, end));
      if (typeof answer === 'string' && Number.isFinite(remainingMs) && remainingMs > 0) {
        return { reader, answer, remainingMs, remainingSeconds: Number(remainingSeconds) || 0 };
      }
      break;
    }
  }
  throw new Error('El servidor cerró la conexión antes de abrir la escucha.');
};

const waitForIce = (peer: RTCPeerConnection) => new Promise<void>(resolve => {
  if (peer.iceGatheringState === 'complete') { resolve(); return; }
  const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
  const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
  const timer = setTimeout(finish, 1500);
  peer.addEventListener('icegatheringstatechange', changed);
});

export const openAiVoiceConnection = async ({ output, signal, onEvent, onDisconnect }: {
  output: MediaStream;
  signal: AbortSignal;
  onEvent: (event: OpenAiVoiceEvent) => void;
  onDisconnect: (message: string) => void;
}): Promise<OpenAiVoiceConnection> => {
  const abort = new AbortController();
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel('oai-events');
  let closed = false;
  let disconnectMessage: string | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout>;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(deadlineTimer);
    signal.removeEventListener('abort', close);
    abort.abort();
    peer.close();
    rejectReady(new Error('Se cerró la conexión con OpenAI.'));
  };
  const dropped = (message: string) => {
    if (closed) return;
    disconnectMessage = message;
    close();
    onDisconnect(message);
  };
  signal.addEventListener('abort', close, { once: true });
  channel.addEventListener('message', message => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === 'session.created' || event.type === 'transcription_session.created') {
        if (event.session?.type && event.session.type !== 'transcription') {
          dropped('OpenAI no abrió una sesión de transcripción.');
        } else resolveReady();
      } else onEvent(event);
    } catch {
      dropped('La respuesta de OpenAI no era válida.');
    }
  });
  channel.addEventListener('close', () => dropped('Se cerró la conexión con OpenAI.'));
  peer.addEventListener('connectionstatechange', () => {
    if (['failed', 'disconnected'].includes(peer.connectionState)) dropped('Se interrumpió la conexión con OpenAI.');
  });
  const setupTimeout = setTimeout(() => dropped('OpenAI tardó demasiado en conectar.'), 21_000);
  try {
    if (signal.aborted) throw new Error('Se canceló la escucha.');
    peer.addTrack(output.getAudioTracks()[0], output);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIce(peer);
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-AI-Theatre-Admin': '1' },
      signal: abort.signal,
      body: JSON.stringify({ rehearsal: true, sdp: peer.localDescription?.sdp }),
    });
    const { reader, answer, remainingMs, remainingSeconds } = await readAnswer(response);
    const deadline = performance.now() + remainingMs;
    const leaseEnded = () => dropped('Terminó el tramo de OpenAI. Pulsa Activar micrófono para seguir en esta réplica.');
    deadlineTimer = setTimeout(leaseEnded, remainingMs);
    void (async () => {
      try { while (!(await reader.read()).done) { /* The response owns the provider lease. */ } }
      catch { /* Cancellation runs the same cleanup. */ }
      leaseEnded();
    })();
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    await ready;
    if (closed) throw new Error('Se cerró la conexión con OpenAI.');
    return {
      deadline,
      remainingSeconds,
      close,
      send: type => {
        if (channel.readyState !== 'open') throw new Error('Se cerró la conexión con OpenAI.');
        channel.send(JSON.stringify({ type }));
      },
    };
  } catch (error) {
    close();
    throw disconnectMessage ? new Error(disconnectMessage) : error;
  } finally {
    clearTimeout(setupTimeout);
  }
};
