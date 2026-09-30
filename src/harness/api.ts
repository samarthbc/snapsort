// Dev-only, no-UI variant of the test harness: API + local index.
import * as api from '../api';
import { setSessionProvider } from '../api/rpc';
import { pageSessionProvider } from '../api/session';
import * as db from '../db/db';
import * as indexer from '../db/indexer';

setSessionProvider(pageSessionProvider);

(window as unknown as { SnapSortApi: unknown }).SnapSortApi = { ...api, db, indexer };
