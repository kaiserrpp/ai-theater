import { APP_VERSION } from './comparison-version.mjs';
import { PHRASES, SAMPLE_RATE, MAX_SAMPLE_SECONDS, resampleAudio, compareSample, makeFeedbackEntries } from './comparison-core.mjs';
import { createSampleCapture, wavBlob } from './comparison-capture.mjs';
import { transcribeVosk, transcribeWhisper } from './comparison-engines.mjs';
import { buildScriptRecognitionContext } from './script-recognition-context.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search), shareId = params.get('share');
const storageKey = `@teatro_ia_asr_comparison_v1:${shareId || 'standalone'}`;
const back = new URL('/', location.href); if (shareId) back.searchParams.set('share', shareId);
$('back').href = back.href; $('version').textContent = APP_VERSION;
PHRASES.forEach((text, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = text; $('phrase').appendChild(option); });
const custom = document.createElement('option'); custom.value = '-1'; custom.textContent = 'Otra frase…'; $('phrase').appendChild(custom);
$('expected').value = PHRASES[0];
let audio = null, sampleUrl = null, recording = false, opening = false, comparing = false, sending = false;
let controller = null, results = [], currentTrial = null, history = [], sampleEpoch = 0;
let scriptContext = null, contextLoading = true, currentSampleId = null;
try { const stored = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(stored)) history = stored.filter((trial) => trial && typeof trial.expected === 'string' && Array.isArray(trial.results)).slice(-12); } catch {}
const newId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const contextClass = () => window.AudioContext || window.webkitAudioContext;
const canCapture = Boolean(contextClass() && navigator.mediaDevices?.getUserMedia);
const capture = createSampleCapture({
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  createContext: () => { const Context = contextClass(); if (!Context) throw new Error('Safari no ofrece captura de audio en esta página.'); return new Context(); },
  onLevel: (level, seconds) => { $('level').style.width = `${Math.round(level * 100)}%`; $('meter').setAttribute('aria-valuenow', String(Math.round(level * 100))); $('duration').textContent = `${seconds.toFixed(1)} segundos · Puedes hacer pausas.`; },
  onLimit: () => finishRecording('Se ha alcanzado el límite de 45 segundos. La muestra está lista; no se ha avanzado de frase.'),
});

const updateButtons = () => {
  const busy = recording || opening || comparing;
  $('record').disabled = busy || !canCapture; $('stop').disabled = !recording && !opening;
  $('compare').disabled = busy || !audio || !$('expected').value.trim() || ($('use-context').checked && (contextLoading || !scriptContext?.prompt)); $('cancel').disabled = !comparing;
  for (const id of ['phrase', 'expected', 'language', 'order', 'audio-file', 'use-context']) $(id).disabled = busy;
  if (!contextClass()) $('audio-file').disabled = true;
  $('send').disabled = !history.length || sending || busy; $('copy').disabled = !history.length || busy;
};
const report = () => ({ version: 1, appVersion: APP_VERSION, reportType: 'local-asr-comparison',
  userAgent: navigator.userAgent, iosVersion: $('ios').value.trim(), shareId, timingKind: 'offline_processing', audioUploaded: false, trials: history });
const updateReport = () => {
  $('history-count').textContent = `${history.length} comparación${history.length === 1 ? '' : 'es'} guardada${history.length === 1 ? '' : 's'} en este navegador (máximo 12).`;
  $('report').value = JSON.stringify(report(), null, 2); updateButtons();
};
const saveHistory = () => {
  try { localStorage.setItem(storageKey, JSON.stringify(history)); } catch { $('report-status').textContent = 'No se pudo recordar el informe en este navegador. Puedes copiarlo o enviarlo ahora.'; }
  updateReport();
};
const clearSample = () => {
  sampleEpoch++; audio = null; results = []; currentTrial = null;
  if (sampleUrl) URL.revokeObjectURL(sampleUrl); sampleUrl = null;
  $('playback').pause(); $('playback').removeAttribute('src'); $('playback').hidden = true;
  $('duration').textContent = 'Sin muestra. Máximo 45 segundos.'; $('results').replaceChildren(); updateButtons();
};
const setSample = (next) => {
  audio = next; currentSampleId = newId();
  if (sampleUrl) URL.revokeObjectURL(sampleUrl);
  sampleUrl = URL.createObjectURL(wavBlob(audio)); $('playback').src = sampleUrl; $('playback').hidden = false;
  $('duration').textContent = `Muestra guardada: ${(audio.length / SAMPLE_RATE).toFixed(2)} segundos. Los dos motores recibirán este mismo audio.`;
  $('status').textContent = 'Muestra lista. Pulsa Comparar muestra.'; updateButtons();
};
const finishRecording = (message = 'Grabación terminada. El micrófono está cerrado.') => {
  capture.stop(); sampleEpoch++; recording = opening = false; $('level').style.width = '0%'; $('meter').setAttribute('aria-valuenow', '0');
  const next = capture.getSample();
  if (next.length) setSample(next);
  $('microphone-status').textContent = message; updateButtons();
};
$('record').onclick = async () => {
  clearSample(); const run = sampleEpoch; opening = true; updateButtons();
  $('playback').pause(); $('microphone-status').textContent = 'Abriendo micrófono… espera antes de hablar.';
  try {
    const started = await capture.start();
    if (!started || run !== sampleEpoch) return;
    recording = true; $('microphone-status').textContent = 'Grabando. Habla y haz tus pausas; pulsa Terminar grabación cuando acabes.';
  } catch (error) { if (run === sampleEpoch) $('microphone-status').textContent = `No se pudo abrir el micrófono: ${error.message}. Puedes reintentar.`; }
  finally { if (run === sampleEpoch) { opening = false; updateButtons(); } }
};
$('stop').onclick = () => finishRecording();
$('phrase').onchange = () => { clearSample(); const index = Number($('phrase').value); $('expected').value = index < 0 ? '' : PHRASES[index]; updateButtons(); };
$('expected').oninput = updateButtons;
$('use-context').onchange = updateButtons;
$('ios').oninput = updateReport;
$('audio-file').onchange = async () => {
  const file = $('audio-file').files[0]; if (!file) return;
  clearSample(); const run = sampleEpoch; let context;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('Elige un archivo de menos de 30 MB.');
    const Context = contextClass(); context = new Context();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (run !== sampleEpoch || document.hidden) return;
    if (decoded.duration > MAX_SAMPLE_SECONDS) throw new Error('Elige un fragmento de hasta 45 segundos.');
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += values[i] / decoded.numberOfChannels;
    }
    setSample(resampleAudio(mono, decoded.sampleRate)); $('microphone-status').textContent = 'Archivo abierto localmente. El micrófono está cerrado.';
  } catch (error) { $('status').textContent = error.message || 'No se pudo abrir el audio.'; }
  finally { if (context) void context.close().catch(() => {}); $('audio-file').value = ''; }
};

const renderResults = () => {
  $('results').replaceChildren();
  for (const result of results) {
    const section = document.createElement('div'); section.className = 'result';
    const title = document.createElement('h3'); title.textContent = result.engine === 'vosk' ? 'Vosk · español actual' : 'Whisper Tiny · multilingüe'; section.appendChild(title);
    const transcript = document.createElement('p'); transcript.className = 'transcript'; transcript.textContent = result.text || (result.status === 'error' ? result.error : 'Sin palabras reconocidas.'); section.appendChild(transcript);
    if (result.status === 'done') {
      const decision = document.createElement('p'); decision.className = result.accepted ? 'good' : 'waiting';
      decision.textContent = result.accepted ? 'Inteligente aceptaría esta réplica.' : 'Inteligente seguiría esperando.'; section.appendChild(decision);
      const metrics = document.createElement('div'); metrics.className = 'metrics';
      for (const text of [`Coincidencia: ${Math.round(result.score * 100)} %`, `Carga: ${(result.loadMs / 1000).toFixed(2)} s`,
        `Procesado: ${(result.processingMs / 1000).toFixed(2)} s`, `Diferencia literal: ${Math.round(result.literalDifference * 100)} %`]) {
        const item = document.createElement('span'); item.textContent = text; metrics.appendChild(item);
      }
      section.appendChild(metrics);
      if (result.languageUsed) { const language = document.createElement('p'); language.className = 'muted'; language.textContent = `Idioma usado: ${result.languageUsed === 'spanish' ? 'español' : 'inglés'}.`; section.appendChild(language); }
      if (result.engine === 'whisper') { const note = document.createElement('p'); note.className = 'muted'; note.textContent = result.contextUsed ? `Contexto del guion aplicado (${result.contextTermCount} términos).` : 'Sin contexto del guion.'; section.appendChild(note); }
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'La diferencia literal compara con el guion sin las equivalencias. Si cambiaste palabras al interpretar, esa diferencia no demuestra un error del motor.'; section.appendChild(note);
      const row = document.createElement('div'); row.className = 'row verdict';
      for (const [value, label] of [['correct', 'Me ha entendido'], ['incorrect', 'No me ha entendido']]) {
        const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label;
        button.setAttribute('aria-pressed', String(result.verdict === value));
        button.onclick = () => { result.verdict = result.verdict === value ? null : value; if (currentTrial) saveHistory(); renderResults(); };
        row.appendChild(button);
      }
      section.appendChild(row);
    } else transcript.classList.add('error');
    $('results').appendChild(section);
  }
};
$('compare').onclick = async () => {
  if (!audio || comparing || recording || opening) return;
  comparing = true; results = []; currentTrial = null; renderResults(); updateButtons();
  $('playback').pause();
  const active = new AbortController(); controller = active;
  const trial = { id: newId(), createdAt: new Date().toISOString(), expected: $('expected').value.trim(),
    sampleId: currentSampleId, context: $('use-context').checked ? scriptContext : null,
    phraseIndex: Number($('phrase').value), language: $('language').value, order: $('order').value.split(','),
    durationMs: Math.round(audio.length / SAMPLE_RATE * 1000), results: [] };
  try {
    trial.results = await compareSample({ audio, expected: trial.expected, context: trial.context, language: trial.language, order: trial.order,
      engines: { vosk: transcribeVosk, whisper: transcribeWhisper }, signal: active.signal,
      onProgress: (engine, message) => { $('status').textContent = `${engine === 'vosk' ? 'Vosk' : 'Whisper'} · ${message}`; },
      onResult: (result) => { results.push(result); renderResults(); },
    });
    currentTrial = trial; history.push(trial); history = history.slice(-12); saveHistory();
    $('status').textContent = 'Comparación terminada. Valora cada transcripción y envía el informe si quieres compartir el resultado. No se ha cambiado de frase.';
  } catch (error) { $('status').textContent = error.message; }
  finally { comparing = false; if (controller === active) controller = null; updateButtons(); }
};
$('cancel').onclick = () => controller?.abort();
const suspend = () => {
  if (recording || opening) finishRecording('Grabación pausada al salir de la página. El micrófono está cerrado; puedes comparar la parte grabada o repetirla.');
  if (controller) controller.abort(); $('playback').pause();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', suspend);
$('copy').onclick = async () => {
  updateReport();
  try { await navigator.clipboard.writeText($('report').value); $('report-status').textContent = 'Informe copiado, sin audio.'; }
  catch { $('report').closest('details').open = true; $('report').focus(); $('report').select(); $('report-status').textContent = 'Selecciona y copia el informe que aparece abajo.'; }
};
$('send').onclick = async () => {
  if (sending || !history.length) return;
  sending = true; updateButtons(); $('report-status').textContent = 'Enviando textos y tiempos, sin audio…';
  const sentTrials = history.slice();
  const sendingController = new AbortController();
  const sendingTimeout = setTimeout(() => sendingController.abort(), 20000);
  try {
    const response = await fetch('/api/shared-script/intelligent-feedback', { method: 'POST', credentials: 'include', signal: sendingController.signal,
      headers: { 'Content-Type': 'application/json', 'X-AI-Theatre-Admin': '1', Accept: 'application/json' },
      body: JSON.stringify({ sessionId: `comparison-${newId()}`, scriptId: `asr-comparison-${shareId || 'standalone'}`, shareId,
        scriptTitle: 'Comparación local Whisper y Vosk', appVersion: APP_VERSION, userRoles: ['PRUEBA LOCAL'],
        userAgent: `${navigator.userAgent}; iOS indicado: ${$('ios').value.trim()}`,
        entries: sentTrials.flatMap(makeFeedbackEntries) }),
    });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'No se pudo enviar. Puedes copiar el informe.');
    $('report-status').textContent = `Informe enviado: ${sentTrials.length} comparaciones, sin audio.`;
  } catch (error) { $('report-status').textContent = error.name === 'AbortError' ? 'El envío ha tardado demasiado. Puedes reintentar o copiar el informe.' : error.message || 'No se pudo enviar el informe.'; }
  finally { clearTimeout(sendingTimeout); sending = false; updateButtons(); }
};
updateReport();
const loadContext = async () => {
  try {
    let lines = PHRASES.map((t) => ({ t })), characters = [];
    if (shareId) {
      const response = await fetch(`/api/shared-script?shareId=${encodeURIComponent(shareId)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('No se pudo leer el guion compartido.');
      const manifest = await response.json();
      const scripts = [manifest.scriptData, ...(manifest.auditionScenes || []).map((scene) => scene.scriptData)].filter(Boolean);
      lines = scripts.flatMap((script) => script.guion || []);
      characters = scripts.flatMap((script) => script.personajes || []);
    }
    scriptContext = buildScriptRecognitionContext(lines, characters);
    $('context-status').textContent = scriptContext.prompt
      ? `${scriptContext.names.length} nombres y ${scriptContext.vocabulary.length} palabras del ${shareId ? 'guion compartido' : 'vocabulario de ejemplo'}. La réplica que escribas arriba se usa solo para evaluar el resultado.`
      : 'El guion no contiene vocabulario. Puedes comparar sin contexto.';
    $('context-words').textContent = scriptContext.prompt || 'Sin vocabulario.';
  } catch {
    $('context-status').textContent = 'No se pudo preparar el contexto. Recarga para reintentarlo o desmarca la opción para comparar sin contexto.';
  } finally { contextLoading = false; updateButtons(); }
};
void loadContext();
if (!canCapture) $('microphone-status').textContent = 'Este navegador no ofrece la captura de audio necesaria. Abre esta prueba en Safari del iPhone.';
