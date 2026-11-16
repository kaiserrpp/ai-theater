"""Prepare reusable warm-up audio locally. No service, API key or audio separation.

Dependencies: numpy, scipy, piper-tts. Inputs are explicit local paths.
Only reviewed symbolic scores in source.json are rendered.
"""
import argparse
import base64
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import wave

import numpy as np
from scipy.io import wavfile
from piper import PiperVoice, SynthesisConfig

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--samples', required=True)
parser.add_argument('--voice', required=True)
parser.add_argument('--ffmpeg', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--root', type=int, help='Render one piano entry for the first fidelity check')
parser.add_argument('--reuse-piano-catalog', help='Reuse unchanged prepared piano files while regenerating explanations and advice')
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
catalog = json.loads(Path(args.source).read_text(encoding='utf8'))
reuse_path = Path(args.reuse_piano_catalog) if args.reuse_piano_catalog else None
reuse = json.loads(reuse_path.read_text(encoding='utf8')) if reuse_path else None
samples_text = Path(args.samples).read_text(encoding='utf8')
body = samples_text.split('MIDI.Soundfont.acoustic_grand_piano = ', 1)[1].strip().rstrip(';')
samples = json.loads(re.sub(r',\s*}', '}', body))
sample_names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
sample_cache = {}
rate = 44100


def ffmpeg(arguments, data=None):
    return subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', *arguments],
                          input=data, capture_output=True, check=True).stdout


def sample(midi):
    if midi not in sample_cache:
        name = sample_names[midi % 12] + str(midi // 12 - 1)
        encoded = samples[name].split(',', 1)[1]
        raw = ffmpeg(['-i', 'pipe:0', '-f', 'f32le', '-ar', str(rate), '-ac', '1', 'pipe:1'], base64.b64decode(encoded))
        sample_cache[midi] = np.frombuffer(raw, dtype='<f4').copy()
    return sample_cache[midi]


def add_note(target, midi, at, duration, gain):
    source = sample(midi)
    count = min(len(source), int((duration + .08) * rate))
    audio = source[:count].copy() * gain
    attack = min(count, int(.004 * rate))
    audio[:attack] *= np.linspace(0, 1, attack)
    release = min(count, int(.08 * rate))
    audio[-release:] *= np.linspace(1, 0, release)
    index = int(at * rate)
    usable = min(len(audio), len(target) - index)
    target[index:index + usable] += audio[:usable]


def encode(name, signal, sample_rate=rate):
    peak = np.max(np.abs(signal))
    if peak <= 0:
        raise ValueError('Prepared audio is silent: ' + name)
    signal = signal * (.8 / peak)
    buffer = io.BytesIO()
    wavfile.write(buffer, sample_rate, (signal * 32767).astype(np.int16))
    # Seekable output lets LAME write encoder delay/padding for gapless decoding.
    ffmpeg(['-y', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-write_xing', '1', str(output / name)], buffer.getvalue())
    return {'audioUrl': name, 'durationSeconds': round(len(signal) / sample_rate, 3),
            'pcmFrames': round(len(signal) / sample_rate * rate), 'pcmSampleRate': rate}


voice = PiperVoice.load(args.voice, use_cuda=False)
def explain(text, name):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        voice.synthesize_wav(text, wav, SynthesisConfig(speaker_id=1, length_scale=1.03))
    voice_rate, speech = wavfile.read(io.BytesIO(buffer.getvalue()))
    speech = speech.astype(float) / 32768
    speech = np.concatenate([speech, np.zeros(round(.6 * voice_rate))])
    return encode(name, speech, voice_rate)


for exercise in catalog['exercises']:
    exercise['explanation'] = explain(exercise['instructions'], exercise['id'] + '-explanation.mp3')
    for index, cue in enumerate(exercise['cues']):
        cue['audio'] = explain(cue['text'], f'{exercise["id"]}-tip-{index}.mp3')
    if reuse:
        previous = next(item for item in reuse['exercises'] if item['id'] == exercise['id'])
        if previous['score'] != exercise['score']:
            raise ValueError('Cannot reuse piano for a changed score: ' + exercise['id'])
        exercise['piano'] = previous['piano']
        for take in exercise['piano'].values():
            name = take['audioUrl']
            if Path(name).name != name or not name.endswith('.mp3'):
                raise ValueError('Expected local prepared piano filename')
            if (reuse_path.parent / name).resolve() != (output / name).resolve():
                shutil.copyfile(reuse_path.parent / name, output / name)
        print('Reused piano', exercise['id'], flush=True)
        continue
    exercise['piano'] = {}
    score = exercise['score']
    beat = 60 / score['tempoBpm']
    total = (score['preparationBeats'] + sum(score['noteBeats']) + score['closingBeats']) * beat
    roots = [args.root] if args.root is not None else range(36, 78)
    for root in roots:
        signal = np.zeros(round(total * rate), dtype=float)
        preparation = score['preparationBeats'] * beat
        for offset in score['entranceNotes']:
            add_note(signal, root + offset, 0, max(.1, preparation - .12), .42)
        at = preparation
        for offset, beats in zip(score['offsets'], score['noteBeats'], strict=True):
            duration = beats * beat
            add_note(signal, root + offset, at, duration, .62)
            at += duration
        for offset in score['closingNotes']:
            add_note(signal, root + offset, at, score['closingBeats'] * beat - .1, .38)
        fade = min(len(signal), round(.025 * rate))
        signal[-fade:] *= np.linspace(1, 0, fade)
        exercise['piano'][str(root)] = encode(f'{exercise["id"]}-piano-{root}.mp3', signal)
        print(exercise['id'], root, round(total, 3), flush=True)
if catalog.get('rest'):
    catalog['rest']['audio'] = explain(catalog['rest']['text'], 'warmup-drinking-rest.mp3')
(output / 'catalog.local.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf8')
files = {take['audioUrl'] for exercise in catalog['exercises'] for take in [exercise['explanation'], *exercise['piano'].values(), *(cue['audio'] for cue in exercise['cues'])]}
if catalog.get('rest'):
    files.add(catalog['rest']['audio']['audioUrl'])
bundle = {'catalog': catalog, 'files': {name: base64.b64encode((output / name).read_bytes()).decode('ascii') for name in sorted(files)}}
(output / 'prepared.warmup.json').write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf8')
print('Prepared', output, flush=True)
