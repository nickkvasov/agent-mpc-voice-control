// The end-to-end tour: run from the project root with the stack up (npm run dev:all).
//   node scripts/demo/tour.mjs
// Spends about six real assistant turns and one YouTube search. Output: .demo/voice-video-tour.mp4
import { HARNESS, callsOf, clip, config, turn } from './app.mjs';

const { record, sleep } = await import(HARNESS);

await record({ ...config, name: 'voice-video-tour' }, async ({ page, say, card, ask, turnEnds, humanClick, humanType, point, focus, pan, text }) => {
  // The browser's own prompt() is how this page asks for a confirmation. A recording does not show
  // native dialogs, so the question is kept and the caption reports it. Answered the way a person
  // would type it.
  let lastQuestion = null;
  page.on('dialog', (dialog) => {
    lastQuestion = dialog.message();
    void dialog.accept('maybe');
  });

  const assistant = async (words, whileWaiting) => {
    await ask(words);
    await turn(page, words).waitFor({ timeout: 2000 });
    if (whileWaiting !== undefined) await whileWaiting();
    await turnEnds();
  };
  const stateText = async () => (await text('[data-testid="state"]')).trim();
  const until = async (check, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await check()) return true; await sleep(250); }
    return false;
  };

  await card('Voice Video Control', 'A YouTube library you drive by typing or speaking — with an assistant that acts through the page’s own tools, and never behind your back.', 5000);

  // ── 1. Find and narrow through the assistant ─────────────────────────────
  await say('human', 'Anything the page does not recognise goes to the assistant.', 2600);
  await assistant('find talks about finite state machines, only the short ones', async () => {
    await say('note', `Acknowledged at once, on the page: “${(await text('[data-testid="assistant-turn"] [data-testid="turn-state"]')).trim()}”`, 0);
  });
  const findCalls = await callsOf(page, 'find talks about finite state machines, only the short ones');
  const shown = await page.locator('[data-testid="result-item"]').count();
  await point('[data-testid="assistant-turn"] ul', 2000);
  await say('agent', clip(`It called ${findCalls.map((c) => c.split(' ')[0]).join(', then ')}.`), 3000);
  await focus('[data-testid="results"]', 1600);
  const narrowed = findCalls.some((c) => c.startsWith('catalog.narrow ✓'));
  await point('[data-testid="results-criteria"]', 1200);
  await say('note', narrowed
    ? `${shown} short talks on screen. Narrowing filtered what was loaded — one search, nothing more spent.`
    : `${shown} results on screen; the assistant did not narrow this time.`, 4200);

  // ── 2. Play the one you name ─────────────────────────────────────────────
  await pan('top', 1400);
  await assistant('play the first one');
  await focus('[data-testid="player"]', 1800);
  const playing = await until(async () => (await stateText()).includes('playing'));
  const nowPlaying = (await text('[data-testid="now-playing"]')).replace('Now playing: ', '').trim();
  await say('agent', playing ? clip(`Playing “${nowPlaying}” — the real YouTube embed, confirmed by the player.`) : `The player reports ${await stateText()}.`, 4000);

  // ── 3. Typed playback commands never wait for a model ────────────────────
  await pan('top', 1400);
  await say('human', 'Recognised playback commands are handled on the page itself.', 2400);
  await ask('pause');
  await until(async () => (await text('[data-testid="understood"]')).includes('pause'), 3000);
  await point('[data-testid="interpretation"]', 1600);
  await focus('[data-testid="controls"]', 1400);
  await until(async () => (await stateText()).includes('paused'), 3000);
  await point('[data-testid="state"]', 1400);
  await say('note', `Understood locally and applied — the player now reports “${await stateText()}”. No assistant turn.`, 3600);
  await pan('top', 1200);
  await ask('play');
  await until(async () => (await stateText()).includes('playing'), 4000);

  // ── 4. Your hand beats the assistant ─────────────────────────────────────
  await say('human', 'Ask the assistant to go back — then type “pause” before it acts.', 3000);
  await assistant('go back a bit', async () => {
    await humanType(config.input, 'pause', 10);
    await page.click(config.submit);
  });
  const backCalls = await callsOf(page, 'go back a bit');
  const overtaken = backCalls.find((c) => c.includes('issued later, already changed this'));
  await point('[data-testid="assistant-turn"] ul', 1800);
  await say('agent', overtaken !== undefined
    ? 'The pause came later but applied first, so the assistant’s older seek was refused, not applied over it.'
    : clip(`This time the assistant acted first: ${backCalls.join(' · ')}`), 4600);

  // ── 5. Every assistant action is recorded, and can be undone ─────────────
  await assistant('queue the second one');
  await focus('[data-testid="queue"]', 1600);
  const queued = await page.locator('[data-testid="queue-item"]').count();
  await say('agent', `Queued — the queue now holds ${queued}.`, 2600);
  await focus('[data-testid="activity"]', 1600);
  const entries = await page.locator('[data-testid="activity-entry"]').count();
  await say('note', `${entries} entries so far: every call, by hand or by the assistant, in the page’s own words.`, 3600);
  const undoable = '[data-testid="activity-entry"]:has([data-testid="undo-button"])';
  const undoTarget = (await page.locator(undoable).first().locator('[data-testid="activity-description"]').innerText()).trim();
  if (!undoTarget.startsWith('Queue')) throw new Error(`the newest undoable entry is not the queueing: ${undoTarget}`);
  await say('human', clip(`Undo “${undoTarget}”.`), 1800);
  await humanClick(`${undoable} [data-testid="undo-button"]`, 1000);
  await focus('[data-testid="queue"]', 1400);
  await until(async () => (await page.locator('[data-testid="queue-item"]').count()) === 0, 3000);
  await say('note', `The queue holds ${await page.locator('[data-testid="queue-item"]').count()} again.`, 2800);

  // ── 6. Discarding asks first, and “maybe” is not yes ─────────────────────
  await say('human', 'By hand: a collection called Favourites, with the first result in it.', 0);
  await focus('[data-testid="curation"]', 1400);
  await humanType('[data-testid="collection-name"]', 'Favourites');
  await humanClick('[data-testid="collection-create"]', 700);
  await focus('[data-testid="results"]', 1200);
  await humanClick('[data-testid="result-item"] [data-testid="add-to-collection"]', 900);
  await focus('[data-testid="curation"]', 1200);
  await say('human', 'A collection with one video, made by hand. Now ask the assistant to remove it.', 3000);
  await pan('top', 1200);
  await assistant('remove the video from my Favourites collection');
  const removeCalls = await callsOf(page, 'remove the video from my Favourites collection');
  await say('note', lastQuestion === null ? 'The page did not ask anything.' : clip(`The page asked “${lastQuestion}” — and the answer typed was “maybe”.`, 220), 4200);
  await point('[data-testid="assistant-turn"] ul', 1800);
  const refusedRemoval = removeCalls.some((c) => c.startsWith('curation.removeFromCollection — refused'));
  await focus('[data-testid="curation"]', 1400);
  const left = await page.locator('[data-testid="collection-video"]').count();
  await say('agent', refusedRemoval && left === 1
    ? '“Maybe” is not a yes: the removal was refused and the video is still in Favourites.'
    : clip(`Outcome: ${removeCalls.join(' · ')} — ${left} video(s) left.`), 4400);

  // ── 7. The assistant’s account comes from the record ─────────────────────
  await pan('top', 1200);
  await say('human', 'Finally: “what did you just do?”', 0);
  await assistant('what did you just do?');
  await point('[data-testid="assistant-turn"] [data-testid="turn-message"]', 1200);
  // Its last message is the account; an earlier one is usually "I'll check the record."
  const account = (await turn(page, 'what did you just do?').locator('[data-testid="turn-message"]').allInnerTexts()).at(-1) ?? '';
  await say('agent', clip(account.replace(/\s+/g, ' ').trim(), 230), 5600);

  await card('Evidence, not a re-enactment', 'Everything here was typed and clicked on the running application — real embed, real search, real model.', 4500);
});
