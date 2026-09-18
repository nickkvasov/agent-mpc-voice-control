#!/usr/bin/env python3
"""The LinkedIn cut of a recorded tour: 1080x1350 (4:5), about a minute, readable on a phone.

    python3 scripts/demo/linkedin-cut.py .demo/voice-video-tour-2026-09-14-1151.mp4

Writes docs/media/voice-video-tour-linkedin-<YYYY-MM-DD-HHMM>.mp4. Needs ffmpeg (with libfreetype) and
the Python packages fonttools and brotli.

Structure, for a viewer who has never seen the app: an intro card saying what they are about to see,
then four numbered steps in the order they happened. Each step opens on the request being typed, then
cuts to a zoom on the place its result appears — the assistant's tool calls, the results, the player —
because the whole screen at phone size is too small to read. The shot times and zoom regions belong to
the 2026-09-14 11:51 take; a new take needs its own, read from a timestamped contact sheet.

Uses the app's own typefaces, instanced to static fonts from the bundled variable ones, because
ffmpeg's drawtext loads a font file, not a weight of a variable font.
"""
import datetime
import pathlib
import subprocess
import sys
import tempfile

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

if len(sys.argv) < 2:
    sys.exit('usage: linkedin-cut.py <source tour mp4> [output mp4]')
SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else f"docs/media/voice-video-tour-linkedin-{datetime.datetime.now():%Y-%m-%d-%H%M}.mp4"
D = pathlib.Path(tempfile.mkdtemp(prefix='linkedin-cut-'))

FONTS = 'node_modules/@fontsource-variable'
for path, name, loc in [
    (f'{FONTS}/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2', 'bricolage-650.ttf', {'wght': 650, 'opsz': 72}),
    (f'{FONTS}/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2', 'atkinson-500.ttf', {'wght': 500}),
    (f'{FONTS}/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2', 'atkinson-700.ttf', {'wght': 700}),
]:
    font = TTFont(path)
    axes = {axis.axisTag for axis in font['fvar'].axes}
    static = instancer.instantiateVariableFont(font, {k: v for k, v in loc.items() if k in axes})
    static.flavor = None
    static.save(D / name)

TITLE_F, CAP_F, BOLD_F = D / 'bricolage-650.ttf', D / 'atkinson-500.ttf', D / 'atkinson-700.ttf'
W, H, BG, INK, YEL, SLATE = 1080, 1350, '0x16213a', 'white', '0xffd84a', '0x9ba6bd'
VIEW_Y, VIEW_H = 210, 760  # the zoomed view: full width, 1080x760

# Zoom regions in the source frame (1512x944), each 1080:760 so nothing is stretched.
CONSOLE_TOP = (895, 205, 520, 366)   # the command box and the "Heard" panel
CONSOLE_LIST = (895, 430, 520, 366)  # the assistant's turns and their tool calls
RESULTS = (95, 20, 820, 577)         # the results panel, once the page has scrolled to it
PLAYER = (50, 85, 880, 619)          # the player, what is playing, and its reported state

STEPS = [  # (label, title, [(source start, duration, region, caption)])
    ('Step 1 of 4', 'Ask in plain words', [
        (9, 3, CONSOLE_TOP, '“Find talks about finite state machines, only the short ones.”'),
        (13, 9, CONSOLE_LIST, 'The assistant can only call tools the page declared. It calls two: catalog.search, then catalog.narrow.'),
        (28, 5, RESULTS, 'Six short talks on screen. Narrowing filtered what was already loaded, so no second search.'),
    ]),
    ('Step 2 of 4', 'Point at what is on screen', [
        (36, 3, CONSOLE_TOP, '“Play the first one.”'),
        (39, 8, PLAYER, 'It works out which video “the first one” is and plays it. The page says “playing” only after the YouTube player confirms.'),
    ]),
    ('Step 3 of 4', 'The person’s action wins', [
        (72, 3.5, CONSOLE_TOP, '“Go back a bit.” While the assistant is still working, the person types “pause”.'),
        (76, 9, CONSOLE_LIST, 'The pause lands first, so the assistant’s older seek is refused with the reason, not applied on top of it.'),
    ]),
    ('Step 4 of 4', 'Nothing destructive without a yes', [
        (131, 3, CONSOLE_TOP, '“Remove the video from my Favourites collection.”'),
        (137, 10, CONSOLE_LIST, 'The page asks the person to confirm, and they answer “maybe”. Not a yes: the removal is refused and nothing changes.'),
    ]),
]


def width(font_path, text, size):
    font = TTFont(font_path)
    cmap, hmtx, upm = font.getBestCmap(), font['hmtx'], font['head'].unitsPerEm
    return sum(hmtx[cmap.get(ord(c), cmap[ord('?')])][0] for c in text) * size / upm


def wrap(font_path, text, size, max_width):
    lines, current = [], ''
    for word in text.split():
        trial = word if not current else f'{current} {word}'
        if width(font_path, trial, size) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return '\n'.join(lines)


counter = iter(range(10_000))


def text(font, content, size, color, x, y):
    """A drawtext filter reading its text from a file, so quotes and colons need no escaping."""
    path = D / f'text-{next(counter)}.txt'
    path.write_text(content)
    return (f"drawtext=fontfile={font}:textfile={path}:expansion=none:fontsize={size}:fontcolor={color}"
            f":x={x}:y={y}:line_spacing={int(size * 0.3)}")


def encode(filter_complex, out, inputs=()):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', filter_complex, '-map', '[v]',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', str(out)],
                   check=True)


def card(lines, duration, out):
    """A plain card: [(font, text, size, color, y)], each line centred."""
    chain = [text(f, wrap(f, t, s, 920), s, c, '(w-text_w)/2', y) for f, t, s, c, y in lines]
    encode(f"color=c={BG}:s={W}x{H}:r=30:d={duration}," + ','.join(chain) +
           f",fade=t=in:st=0:d=0.4,fade=t=out:st={duration - 0.3}:d=0.3[v]", out)


parts = []

intro = D / 'intro.mp4'
card([(TITLE_F, 'An AI assistant inside a React app', 58, INK, 350),
      (CAP_F, 'It can only use the actions the app itself declares as tools, with agent-mcp-react.', 46, INK, 540),
      (BOLD_F, 'Four real requests, recorded live.', 40, YEL, 760)], 4.5, intro)
parts.append(intro)

for step, (label, title, shots) in enumerate(STEPS):
    for shot, (start, duration, (x, y, w, h), caption) in enumerate(shots):
        chain = [f"[bg][view]overlay=0:{VIEW_Y}:shortest=1",
                 text(BOLD_F, label, 34, YEL, 60, 56),
                 text(TITLE_F, title, 58, INK, 60, 108),
                 text(CAP_F, wrap(CAP_F, caption, 48, 960), 48, INK, 60, VIEW_Y + VIEW_H + 44),
                 text(CAP_F, 'github.com/nickkvasov/agent-mpc-voice-control', 28, SLATE, 60, H - 76)]
        # Fade only at the edges of a step; cuts inside a step stay hard, so it reads as one moment.
        if shot == 0:
            chain.append('fade=t=in:st=0:d=0.25')
        if shot == len(shots) - 1:
            chain.append(f'fade=t=out:st={duration - 0.25}:d=0.25')
        out = D / f'step-{step}-{shot}.mp4'
        encode(f"color=c={BG}:s={W}x{H}:r=30:d={duration}[bg];"
               f"[0:v]crop={w}:{h}:{x}:{y},scale={W}:{VIEW_H}:flags=lanczos,fps=30[view];" + ','.join(chain) + '[v]',
               out, ['-ss', str(start), '-t', str(duration), '-i', SRC])
        parts.append(out)

outro = D / 'outro.mp4'
card([(TITLE_F, 'agent-mcp-react', 96, YEL, 430),
      (CAP_F, 'Your React app’s own actions, as tools an AI assistant can call.', 48, INK, 590),
      (CAP_F, 'Library: github.com/A-Launch/agent-mcp-react', 30, SLATE, 820),
      (CAP_F, 'Example: github.com/nickkvasov/agent-mpc-voice-control', 30, SLATE, 870)], 5, outro)
parts.append(outro)

concat = D / 'concat.txt'
concat.write_text(''.join(f"file '{p}'\n" for p in parts))
# A silent track: some uploaders treat a video with no audio stream as broken.
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat),
                '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
