// Runs in the page's own JS context so it can read Google's page variables (the session
// token). Keep this script tiny: it only reads and forwards.

import { readSessionFromPage } from '../api/session';
import { isContentMessage, MAIN_SOURCE, type MainWorldMessage } from '../shared/messages';

function send(message: MainWorldMessage) {
  window.postMessage(message, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !isContentMessage(event.data)) return;
  if (event.data.type === 'getSession') {
    send({
      source: MAIN_SOURCE,
      type: 'session',
      id: event.data.id,
      session: readSessionFromPage(),
    });
  }
});

send({ source: MAIN_SOURCE, type: 'ready' });
