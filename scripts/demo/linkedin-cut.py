#!/usr/bin/env python3
"""The LinkedIn cut of a recorded tour: 1080x1350 (4:5), about a minute, captions sized for a phone.

    python3 scripts/demo/linkedin-cut.py .demo/voice-video-tour-2026-09-14-1151.mp4

Writes docs/media/voice-video-tour-linkedin-<YYYY-MM-DD-HHMM>.mp4. Needs ffmpeg (with libfreetype) and
the Python packages fonttools and brotli. The segment times below belong to the 2026-09-14 11:51 take:
a new take needs its own times, read from a timestamped contact sheet of that take.

Uses the app's own typefaces, instanced to static fonts from the bundled variable ones, because
ffmpeg's drawtext loads a font file, not a weight of a variable font.
"""
import subprocess, sys, pathlib, datetime, tempfile
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

TITLE_F, CAP_F, BOLD_F = D/'bricolage-650.ttf', D/'atkinson-500.ttf', D/'atkinson-700.ttf'
W, H, BG, INK, YEL, SLATE = 1080, 1350, '0x16213a', 'white', '0xffd84a', '0x9ba6bd'
APP_Y = 300

def width(font_path, text, size):
    f = TTFont(font_path); cmap = f.getBestCmap(); hmtx = f['hmtx']; upm = f['head'].unitsPerEm
    return sum(hmtx[cmap.get(ord(c), cmap[ord('?')])][0] for c in text) * size / upm

def wrap(font_path, text, size, maxw):
    lines, cur = [], ''
    for word in text.split():
        trial = word if not cur else f'{cur} {word}'
        if width(font_path, trial, size) <= maxw: cur = trial
        else: lines.append(cur); cur = word
    lines.append(cur); return '\n'.join(lines)

def textfile(name, text):
    p = D/f'{name}.txt'; p.write_text(text); return p

def dt(font, tf, size, color, x, y, extra=''):
    return (f"drawtext=fontfile={font}:textfile={tf}:expansion=none:fontsize={size}:fontcolor={color}"
            f":x={x}:y={y}:line_spacing={int(size*0.28)}{extra}")

CAP_SIZE, CAP_W = 50, 960
title = textfile('title', wrap(TITLE_F, 'An AI assistant driving a React app through its own tools', 58, 960))
lib = textfile('lib', 'built with agent-mcp-react')
foot = textfile('foot', 'github.com/nickkvasov/agent-mpc-voice-control')

SEGMENTS = [  # (source start, duration, [(from, to, caption)])
  (71, 15, [(0, 5, 'Ask the assistant to go back a bit, then type “pause” before it acts.'),
            (5, 15, 'The pause applies first. The assistant’s older seek is refused with the reason, not applied over it.')]),
  (10, 14, [(0, 5, '“Find talks about finite state machines, only the short ones.”'),
            (5, 14, 'The assistant acts only through tools the page declared: catalog.search, then catalog.narrow.')]),
  (36, 10, [(0, 10, '“Play the first one.” The real YouTube player starts, and the page reports it only once the player confirms.')]),
  (131, 16, [(0, 7, '“Remove the video from my Favourites.” The action asks the person first.'),
             (7, 16, 'The answer was “maybe”. That is not a yes: the removal is refused and the video stays.')]),
]

parts = []
for i, (start, dur, caps) in enumerate(SEGMENTS):
    chain = [f"[bg][app]overlay=0:{APP_Y}:shortest=1",
             dt(TITLE_F, title, 58, INK, 60, 64),
             dt(BOLD_F, lib, 34, YEL, 60, 222),
             dt(CAP_F, foot, 30, SLATE, 60, H - 90)]
    for j, (a, b, text) in enumerate(caps):
        tf = textfile(f'cap-{i}-{j}', wrap(CAP_F, text, CAP_SIZE, CAP_W))
        chain.append(dt(CAP_F, tf, CAP_SIZE, INK, 60, APP_Y + 590 + 56, f":enable='between(t,{a},{b})'"))
    chain += ['fade=t=in:st=0:d=0.3', f'fade=t=out:st={dur-0.3}:d=0.3']
    fc = (f"color=c={BG}:s={W}x{H}:r=30:d={dur}[bg];"
          f"[0:v]crop=1392:760:26:10,scale=1080:590:flags=lanczos,fps=30[app];" + ','.join(chain) + '[v]')
    out = D/f'seg-{i}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', SRC, '-filter_complex', fc,
                    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', str(out)], check=True)
    parts.append(out)

# Closing card.
name = textfile('end-name', 'agent-mcp-react')
line = textfile('end-line', wrap(CAP_F, 'Your React app’s own actions, as tools an AI assistant can call.', 48, 900))
links = textfile('end-links', 'github.com/A-Launch/agent-mcp-react\ngithub.com/nickkvasov/agent-mpc-voice-control')
card = D/'seg-end.mp4'
fc = (f"color=c={BG}:s={W}x{H}:r=30:d=4.5," +
      ','.join([dt(TITLE_F, name, 96, YEL, '(w-text_w)/2', 470),
                dt(CAP_F, line, 48, INK, '(w-text_w)/2', 630),
                dt(CAP_F, links, 34, SLATE, '(w-text_w)/2', 860),
                'fade=t=in:st=0:d=0.4']) + '[v]')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-filter_complex', fc, '-map', '[v]', '-t', '4.5',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', str(card)], check=True)
parts.append(card)

lst = D/'concat.txt'; lst.write_text(''.join(f"file '{p}'\n" for p in parts))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
                '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
