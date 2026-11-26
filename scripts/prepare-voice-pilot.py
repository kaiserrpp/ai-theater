"""Prepare private pilot dialogue locally from an exported shared manifest."""
import argparse
import base64
import io
import json
import re
import subprocess
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig


def scene_dialogue(guion):
    start = 0
    dialogue = {}
    for index, line in enumerate(guion):
        if line["p"] == "ESCENA_SISTEMA":
            if dialogue:
                yield start, dialogue
            start, dialogue = index, {}
            continue
        if line["p"] == "CANCION_SISTEMA" or line.get("k") == "song":
            continue
        text = re.sub(r"\s+", " ", re.sub(r"\([^)]*\)", " ", line["t"])).strip()
        if text:
            dialogue[index] = text
    if dialogue:
        yield start, dialogue


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    voice = PiperVoice.load(args.voice)
    synthesis = SynthesisConfig(speaker_id=1, length_scale=1.02)
    scenes = []
    for audition in manifest.get("auditionScenes", []):
        for start, dialogue in scene_dialogue(audition["scriptData"]["guion"]):
            clips = {}
            for index, text in dialogue.items():
                wav = io.BytesIO()
                with wave.open(wav, "wb") as audio:
                    voice.synthesize_wav(text, audio, synthesis)
                mp3 = subprocess.run(
                    [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
                     "-c:a", "libmp3lame", "-b:a", "48k", "-ac", "1", "-f", "mp3", "pipe:1"],
                    input=wav.getvalue(), capture_output=True, check=True,
                ).stdout
                clips[index] = base64.b64encode(mp3).decode("ascii")
            name = f"{audition['id']}-{audition['revision']}-{start}.json"
            path = args.output / name
            path.write_text(json.dumps({"clips": clips}, separators=(",", ":")), encoding="utf-8")
            scenes.append({"share": manifest["shareId"], "audition": audition["id"],
                           "revision": audition["revision"], "scene": start, "file": name})
            print(f"Escena {start}: {len(clips)} voces, {path.stat().st_size} bytes", flush=True)
    (args.output / "index.json").write_text(json.dumps(scenes, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
