/* A standalone check: never require successful speech before testing audio input. */
function createAudioChecks(document, runtime) {
  const element = (id) => document.getElementById(id);
  const synth = runtime.speechSynthesis;
  const AudioContextConstructor = runtime.AudioContext || runtime.webkitAudioContext;
  const report = {
    tool: 'AI-Theatre audio check 1',
    ios: '',
    browser: runtime.navigator.userAgent,
    secure: runtime.isSecureContext,
    available: { voice: Boolean(synth && runtime.SpeechSynthesisUtterance), audio: Boolean(runtime.Audio),
      audioContext: Boolean(AudioContextConstructor), microphone: Boolean(runtime.navigator.mediaDevices?.getUserMedia) },
    voices: [], tests: {},
  };
  let generation = 0;
  let active = null;
  let context = null;
  let stream = null;
  let utterance = null;
  let frame = null;
  let toneUrl = null;
  const audio = runtime.Audio ? new runtime.Audio() : null;
  const timers = new Set();
  const renderReport = () => { element('report').value = JSON.stringify(report, null, 2); };
  const update = (name, state, message, details = {}) => {
    report.tests[name] = { ...report.tests[name], state, message, ...details };
    element(`status-${name}`).textContent = message;
    renderReport();
  };
  const later = (callback, ms) => {
    const id = runtime.setTimeout(() => { timers.delete(id); callback(); }, ms);
    timers.add(id);
  };
  const release = (capture) => capture?.getTracks().forEach((track) => track.stop());
  const stop = (markStopped = true) => {
    ++generation;
    timers.forEach((id) => runtime.clearTimeout(id)); timers.clear();
    if (frame !== null) runtime.cancelAnimationFrame(frame);
    frame = null;
    if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
    utterance = null;
    synth?.cancel();
    if (audio) { audio.onplaying = audio.onended = audio.onerror = null; audio.pause(); }
    release(stream); stream = null;
    if (context) { void context.close().catch(() => {}); context = null; }
    if (active && markStopped) update(active, 'cancelled', 'Prueba detenida.');
    active = null;
  };
  const begin = (name) => {
    stop(); active = name;
    report.tests[name] = { heard: null };
    const heard = element(`heard-${name}`);
    if (heard) {
      heard.hidden = false;
      element(`${name}-yes`).setAttribute('aria-pressed', 'false');
      element(`${name}-no`).setAttribute('aria-pressed', 'false');
    }
    update(name, 'running', 'Preparando la prueba…');
    return generation;
  };
  const finish = (name, run, state, message, details = {}) => {
    if (run !== generation) return;
    update(name, state, message, details); stop(false);
  };
  const fail = (name, run, error) => finish(name, run, 'error',
    `No se ha completado: ${error?.name || 'Error'}${error?.message ? ` · ${error.message}` : ''}.`,
    { error: { name: error?.name || 'Error', message: error?.message || '' } });

  const refreshVoices = () => {
    const voices = synth?.getVoices() || [];
    report.voices = voices.map(({ name, lang, localService, default: isDefault }) => ({ name, lang, localService, default: isDefault }));
    const choice = element('voice-choice');
    const selected = choice.value;
    choice.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = ''; automatic.textContent = 'Automática del sistema'; choice.appendChild(automatic);
    voices.forEach((voice, index) => {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = `${voice.name} · ${voice.lang}`;
      choice.appendChild(option);
    });
    choice.value = selected;
    renderReport();
  };
  const testVoice = () => {
    const run = begin('voice');
    if (!report.available.voice) { fail('voice', run, new Error('Este navegador no ofrece voz sintetizada')); return; }
    try {
      utterance = new runtime.SpeechSynthesisUtterance('Hola. Esta es la prueba de voz de AI Theatre.');
      utterance.lang = 'es-ES'; utterance.rate = 0.96; utterance.volume = 1;
      const selected = element('voice-choice').value;
      const voice = selected === '' ? null : synth.getVoices()[Number(selected)];
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      report.tests.voice.selectedVoice = voice ? `${voice.name} · ${voice.lang}` : 'Automática';
      utterance.onstart = () => {
        if (run === generation) update('voice', 'running', 'Safari indica que está hablando. Marca si la oyes.', { started: true });
      };
      utterance.onend = () => finish('voice', run, 'finished', 'Safari indica que ha terminado. Marca si has oído la voz.', { ended: true });
      utterance.onerror = (event) => fail('voice', run, { name: 'SpeechError', message: event.error });
      later(() => finish('voice', run, 'timeout', 'Safari no ha confirmado el final de la voz. Marca si has oído algo.'), 10000);
      synth.resume();
      synth.speak(utterance); // No promises, media playback or microphone before this call.
    } catch (error) { fail('voice', run, error); }
  };

  const makeToneUrl = () => {
    const count = 3200;
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const write = (offset, value) => Array.from(value).forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
    for (let index = 0; index < count; index += 1) {
      const envelope = Math.min(1, index / 80, (count - index - 1) / 80);
      view.setInt16(44 + index * 2, Math.round(Math.sin(index * 2 * Math.PI * 880 / 8000) * 10000 * envelope), true);
    }
    return runtime.URL.createObjectURL(new runtime.Blob([buffer], { type: 'audio/wav' }));
  };
  const testBeep = () => {
    const run = begin('beep');
    if (!audio) { fail('beep', run, new Error('Este navegador no ofrece reproducción de audio')); return; }
    try {
      toneUrl ||= makeToneUrl();
      audio.src = toneUrl; audio.currentTime = 0; audio.muted = false; audio.volume = 1;
      audio.onplaying = () => { if (run === generation) update('beep', 'running', 'Safari indica que reproduce el pitido.', { started: true }); };
      audio.onended = () => finish('beep', run, 'finished', 'La reproducción ha terminado. Marca si has oído el pitido.', { ended: true });
      audio.onerror = () => fail('beep', run, { name: 'AudioError', message: `Código ${audio.error?.code || 'desconocido'}` });
      audio.load();
      later(() => finish('beep', run, 'timeout', 'Safari no ha confirmado el final del pitido. Marca si lo has oído.'), 6000);
      void audio.play().catch((error) => fail('beep', run, error));
    } catch (error) { fail('beep', run, error); }
  };
  const testGenerated = () => {
    const run = begin('generated');
    if (!AudioContextConstructor) { fail('generated', run, new Error('Este navegador no ofrece generación de audio')); return; }
    try {
      const output = new AudioContextConstructor(); context = output;
      const resumed = output.resume();
      const oscillator = output.createOscillator();
      const gain = output.createGain();
      oscillator.frequency.value = 880; gain.gain.value = 0.15;
      oscillator.connect(gain); gain.connect(output.destination);
      oscillator.onended = () => finish('generated', run, 'finished', 'El pitido generado ha terminado. Marca si lo has oído.', { contextState: output.state });
      oscillator.start(); oscillator.stop(output.currentTime + 0.4);
      later(() => finish('generated', run, 'timeout', 'El navegador no ha completado el pitido generado.', { contextState: output.state }), 6000);
      void resumed.catch((error) => fail('generated', run, error));
    } catch (error) { fail('generated', run, error); }
  };
  const testMicrophone = () => {
    const run = begin('microphone');
    element('microphone-level').style.width = '0%';
    element('microphone-meter').setAttribute('aria-valuenow', '0');
    if (!report.available.microphone || !AudioContextConstructor) {
      fail('microphone', run, new Error('El navegador no ofrece captura y medición del micrófono')); return;
    }
    try {
      const input = new AudioContextConstructor(); context = input;
      const resumed = input.resume(); // Resume in this tap, before the permission prompt.
      const capture = runtime.navigator.mediaDevices.getUserMedia({ audio: true });
      void capture.then((nextStream) => {
        if (run !== generation) release(nextStream);
        else stream = nextStream;
      }, () => {});
      later(() => finish('microphone', run, 'timeout', 'Safari no ha abierto la entrada a tiempo. Revisa la solicitud de permiso.'), 20000);
      void Promise.all([resumed, capture]).then(([, nextStream]) => {
        if (run !== generation) return;
        timers.forEach((id) => runtime.clearTimeout(id)); timers.clear();
        const source = input.createMediaStreamSource(nextStream);
        const analyser = input.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const settings = nextStream.getAudioTracks()[0]?.getSettings?.() || {};
        let peak = 0;
        update('microphone', 'running', 'Entrada abierta. Habla: la barra debería moverse.', {
          opened: true, contextState: input.state,
          settings: { sampleRate: settings.sampleRate, channelCount: settings.channelCount, echoCancellation: settings.echoCancellation },
        });
        const measure = () => {
          if (run !== generation) return;
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
          peak = Math.max(peak, rms);
          const level = Math.min(100, Math.round(rms * 500));
          element('microphone-level').style.width = `${level}%`;
          element('microphone-meter').setAttribute('aria-valuenow', String(level));
          frame = runtime.requestAnimationFrame(measure);
        };
        measure();
        later(() => finish('microphone', run, 'finished', peak > 0.005
          ? 'Ha llegado señal al navegador. El micrófono se ha cerrado.'
          : 'Safari abrió el micrófono, pero no llegó señal apreciable. El micrófono se ha cerrado.',
        { peakRms: Number(peak.toFixed(5)), signalReceived: peak > 0.005, contextState: input.state }), 10000);
      }).catch((error) => fail('microphone', run, error));
    } catch (error) { fail('microphone', run, error); }
  };

  element('test-voice').addEventListener('click', testVoice);
  element('test-beep').addEventListener('click', testBeep);
  element('test-generated').addEventListener('click', testGenerated);
  element('test-microphone').addEventListener('click', testMicrophone);
  element('stop').addEventListener('click', () => stop());
  for (const name of ['voice', 'beep', 'generated']) {
    for (const [suffix, heard] of [['yes', true], ['no', false]]) {
      element(`${name}-${suffix}`).addEventListener('click', () => {
        if (!report.tests[name]) return;
        report.tests[name].heard = heard;
        element(`${name}-yes`).setAttribute('aria-pressed', String(heard));
        element(`${name}-no`).setAttribute('aria-pressed', String(!heard));
        renderReport();
      });
    }
  }
  element('ios-version').addEventListener('input', () => { report.ios = element('ios-version').value.trim(); renderReport(); });
  element('copy').addEventListener('click', async () => {
    try {
      await runtime.navigator.clipboard.writeText(element('report').value);
      element('copy-status').textContent = 'Informe copiado. Pégalo en el chat.';
    } catch {
      element('report').closest('details').open = true;
      element('report').focus(); element('report').select();
      element('copy-status').textContent = 'Informe seleccionado. Usa Copiar para pegarlo en el chat.';
    }
  });
  const onPageHide = () => { stop(); if (toneUrl) { runtime.URL.revokeObjectURL(toneUrl); toneUrl = null; } };
  const onVisibility = () => { if (document.hidden) stop(); };
  runtime.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  synth?.addEventListener('voiceschanged', refreshVoices);
  refreshVoices();
  return { testVoice, testBeep, testGenerated, testMicrophone, stop, getReport: () => structuredClone(report), destroy: onPageHide };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createAudioChecks };
else createAudioChecks(document, window);
