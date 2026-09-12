# Spikes

Throwaway probes that answered a question the design could not settle by reading documentation.
Kept because the *answers* are recorded in `specs/001-voice-video-control/research.md` and someone
will want to re-run these when a browser or the undocumented YouTube surface changes.

| Spike | Question | Answer |
|---|---|---|
| `t008-recognition-probe.mjs`, `t008-headed.mjs` | Is on-device speech recognition really available? | Yes, but `"downloadable"` — and the probe crashes headless Chrome |
| `t007-captions.mjs`, `t007-disable.mjs` | Can the IFrame API control captions at all? | Enable, enumerate and select yes; disable not verifiable |

Both need the dev server running (`npm run dev`, port 5273). The captions spikes must be served over
http — a `file://` origin returns player error 153.
