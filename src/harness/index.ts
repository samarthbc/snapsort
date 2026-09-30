// Dev-only test harness. Not part of the extension: it's injected straight into a
// photos.google.com tab (page context) to exercise the real API and UI code without
// installing the extension. Exposes everything on window.SnapSortHarness.

import * as api from '../api';
import { setSessionProvider } from '../api/rpc';
import { pageSessionProvider } from '../api/session';
import { mount, unmount } from '../content/mount';

setSessionProvider(pageSessionProvider);

(window as unknown as { SnapSortHarness: unknown }).SnapSortHarness = { api, mount, unmount };
