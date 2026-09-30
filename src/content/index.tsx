// Content script (isolated world): wires the API to the MAIN-world session bridge and injects
// the SnapSort launch button.

import { setSessionProvider } from '../api/rpc';
import { bridgeSessionProvider } from '../api/session';
import { mount } from './mount';

setSessionProvider(bridgeSessionProvider());
mount();
