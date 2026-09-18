#!/usr/bin/env python3
"""The LinkedIn cut of a recorded tour: the recording itself, shortened — nothing redrawn.

    python3 scripts/demo/linkedin-cut.py .demo/voice-video-tour-2026-09-14-1151.mp4

Writes docs/media/voice-video-tour-linkedin-<YYYY-MM-DD-HHMM>.mp4. Needs ffmpeg.

The app is shown exactly as recorded — full frame, native resolution, the tour's own caption band and
title cards. The only edits are hard cuts, in story order: waits while the assistant thinks are
trimmed, and beats outside the story are left out. Every cut lands where the recording's own caption
still describes what is on screen. The shot times belong to the 2026-09-14 11:51 take; a new take
needs its own, read from a timestamped contact sheet.
"""
import datetime
import pathlib
import subprocess
import sys
import tempfile

if len(sys.argv) < 2:
    sys.exit('usage: linkedin-cut.py <source tour mp4> [output mp4]')
SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else f"docs/media/voice-video-tour-linkedin-{datetime.datetime.now():%Y-%m-%d-%H%M}.mp4"
D = pathlib.Path(tempfile.mkdtemp(prefix='linkedin-cut-'))

SHOTS = [  # (source start, source end) — what the viewer sees
    (0.5, 4.0),      # the tour's title card
    (5.0, 12.0),     # "Anything the page does not recognise goes to the assistant" — the request is typed
    (19.0, 26.5),    # its tool calls appear: catalog.search, then catalog.narrow
    (27.5, 33.0),    # six short talks in the results; narrowing spent no second search
    (36.0, 47.5),    # "play the first one" — the real YouTube player starts
    (69.5, 87.0),    # "go back a bit", then a typed pause lands first; the older seek is refused
    (127.5, 133.0),  # a collection made by hand; the assistant is asked to remove its video
    (140.0, 153.5),  # the page asked, the answer was "maybe": refused, and the video stays
    (155.8, 158.0),  # "what did you just do?"
    (162.5, 171.0),  # its account, read from the activity record
    (172.0, 175.5),  # the tour's closing card
]

parts = []
for i, (start, end) in enumerate(SHOTS):
    out = D / f'shot-{i:02d}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', f'{end - start:.3f}', '-i', SRC,
                    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
                    str(out)], check=True)
    parts.append(out)

concat = D / 'concat.txt'
concat.write_text(''.join(f"file '{p}'\n" for p in parts))
# A silent track: some uploaders treat a video with no audio stream as broken.
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat),
                '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
