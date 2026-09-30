// Mounts the SnapSort UI into photos.google.com inside a Shadow DOM, so Google's CSS and ours
// can't affect each other.

import { render } from 'preact';
import { App } from '../ui/App';
import styles from './styles.css';

const HOST_ID = 'snapsort-root';

export function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);
  render(<App />, container);
}

export function unmount() {
  document.getElementById(HOST_ID)?.remove();
}
