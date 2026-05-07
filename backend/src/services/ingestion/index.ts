import { EXCLUDE_INTELLME_CLIENT } from '../../config/deployment';
import type { InTellMeClient } from './intellmeClient.stub';
import { intellmeClient as stubClient } from './intellmeClient.stub';
import { intellmeClient as realClient } from './intellmeClient';

export type { InTellMeClient } from './intellmeClient.stub';

export const intellmeClient: InTellMeClient = EXCLUDE_INTELLME_CLIENT
  ? stubClient
  : realClient;
