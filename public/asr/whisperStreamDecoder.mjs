// Generated from src/utils/whisperStreamDecoder.ts.
export const createWhisperStreamDecoder = (sampleRate, context, transcribe, cancel, options = {}) => {
    const { getSchedulingDelay = () => 350, getSpeechThreshold = () => 0.0001, onFinalized } = options;
    const listeners = {};
    let frames = [], samples = 0, processed = 0, processedFrames = 0, lastVoiced = 0, lastSpeech = 0;
    let lastText = '';
    let disposed = false, busy = false, timer = null;
    let finishingInput = false, inputFinished = false;
    const remove = () => {
        if (disposed)
            return;
        disposed = true;
        if (timer !== null)
            clearTimeout(timer);
        frames = [];
        samples = 0;
        cancel();
    };
    const commit = (length, count, text, reason) => {
        const quietMs = lastSpeech ? (samples - lastSpeech) / sampleRate * 1000 : 0;
        frames = frames.slice(count);
        samples -= length;
        lastVoiced = Math.max(0, lastVoiced - length);
        lastSpeech = Math.max(0, lastSpeech - length);
        // Discard only exact digital zeros; never lose unprocessed quiet words.
        while (frames[0]?.every(value => value === 0)) {
            const silentLength = frames.shift().length;
            samples -= silentLength;
            lastVoiced = Math.max(0, lastVoiced - silentLength);
            lastSpeech = Math.max(0, lastSpeech - silentLength);
        }
        processed = processedFrames = 0;
        lastText = '';
        if (text.trim())
            onFinalized?.({ segmentFinalization: reason, trailingQuietMs: Math.round(quietMs), segmentationThreshold: getSpeechThreshold() });
        listeners.result?.({ result: { text } });
    };
    const settleDecodedSpeech = () => {
        if (disposed || busy || !processed || !lastSpeech || lastSpeech > processed || samples - lastSpeech < sampleRate * 0.6)
            return;
        // Finalize only audio the model has actually decoded. The shared matcher
        // still decides advancement; an incomplete replica remains listening.
        commit(processed, processedFrames, lastText, 'speech_gap');
    };
    const finishDecodedInput = () => {
        if (!finishingInput || inputFinished || disposed || busy)
            return;
        if (samples && lastVoiced > processed) {
            schedule();
            return;
        }
        if (lastText.trim())
            commit(processed, processedFrames, lastText, 'input_end');
        inputFinished = true;
        options.onInputFinished?.();
    };
    const pump = async () => {
        timer = null;
        if (disposed || busy || inputFinished)
            return;
        if (lastVoiced <= processed || (!finishingInput && samples < sampleRate * 0.8)) {
            finishDecodedInput();
            return;
        }
        busy = true;
        const count = frames.length, length = samples;
        const pcm = new Float32Array(length);
        let offset = 0;
        frames.forEach((frame) => { pcm.set(frame, offset); offset += frame.length; });
        const ratio = sampleRate / 16000;
        const audio = new Float32Array(Math.floor(length / ratio));
        for (let i = 0; i < audio.length; i++) {
            const at = i * ratio, start = Math.floor(at), end = Math.min(pcm.length - 1, start + 1);
            audio[i] = pcm[start] + (pcm[end] - pcm[start]) * (at - start);
        }
        try {
            const result = await transcribe(audio, typeof context === 'function' ? context() : context, (text) => {
                if (disposed)
                    return;
                // Words from this inference replace its previous partial; they never
                // commit an actor turn. The shared Intelligent matcher evaluates them.
                lastText = text;
                listeners.partialresult?.({ result: { partial: text } });
            });
            if (disposed)
                return;
            processed = length;
            processedFrames = count;
            if (finishingInput || length >= sampleRate * 20) {
                // Commit a bounded audio window, never a silence-based actor turn.
                // SpeechRecognitionSession still decides advancement from its words.
                commit(length, count, result.text, finishingInput ? 'input_end' : 'window_limit');
            }
            else {
                lastText = result.text;
                listeners.partialresult?.({ result: { partial: result.text } });
            }
        }
        catch (error) {
            if (!disposed) {
                remove();
                listeners.error?.({ error: error instanceof Error ? error.message : 'No se pudo transcribir con Whisper.' });
            }
        }
        finally {
            busy = false;
            if (finishingInput) {
                finishDecodedInput();
                return;
            }
            settleDecodedSpeech();
            if (!disposed && lastVoiced > processed)
                schedule();
        }
    };
    const schedule = () => {
        if (!disposed && !busy && !inputFinished && timer === null)
            timer = setTimeout(() => { void pump(); }, finishingInput ? 0 : getSchedulingDelay());
    };
    return {
        on: (event, listener) => { listeners[event] = listener; },
        acceptWaveform: (buffer) => {
            if (disposed || finishingInput)
                return;
            const input = buffer.getChannelData(0).slice();
            let energy = 0, peak = 0;
            for (const value of input) {
                energy += value * value;
                peak = Math.max(peak, Math.abs(value));
            }
            // Keep pauses in the PCM, but don't start repeated neural work for
            // digital silence. This threshold never completes an actor's reply.
            const voiced = peak > 0.0001;
            const speech = Math.sqrt(energy / Math.max(1, input.length)) >= getSpeechThreshold();
            if (!samples && !voiced)
                return;
            if (voiced && !busy && lastText && processed >= lastVoiced && samples - lastVoiced >= sampleRate * 1.5) {
                // Fallback for audio without a calibrated speech boundary: retain
                // the recognized words when speech resumes, then decode a fresh
                // acoustic segment. Only the shared matcher completes the actor turn.
                commit(processed, processedFrames, lastText, 'speech_resume');
                if (disposed)
                    return;
            }
            frames.push(input);
            samples += input.length;
            if (voiced)
                lastVoiced = samples;
            if (speech)
                lastSpeech = samples;
            settleDecodedSpeech();
            if (samples >= sampleRate * 90) {
                remove();
                listeners.error?.({ error: 'Whisper ha acumulado demasiado audio. Reintenta esta réplica.' });
                return;
            }
            schedule();
        },
        ...(options.allowFinishInput ? { finishInput: () => {
                if (disposed || finishingInput)
                    return false;
                finishingInput = true;
                if (timer !== null)
                    clearTimeout(timer);
                timer = null;
                finishDecodedInput();
                return true;
            } } : {}),
        remove,
    };
};
