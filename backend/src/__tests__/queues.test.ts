import { describe, expect, it, vi } from 'vitest';

vi.mock('../queue/redis', () => ({
  createRedisConnection: vi.fn(() => ({
    options: {},
    status: 'ready',
  })),
}));

import {
  ingestionQueue,
  embeddingQueue,
  researchQueue,
  pipelineBIngestionQueue,
  intellmeDeletionQueue,
  atlasExportQueue,
  livingReportRevisionQueue,
} from '../queue/queues';

describe('queues cleanup config', () => {
  const allQueues = [
    { name: 'ingestionQueue', queue: ingestionQueue },
    { name: 'embeddingQueue', queue: embeddingQueue },
    { name: 'researchQueue', queue: researchQueue },
    { name: 'pipelineBIngestionQueue', queue: pipelineBIngestionQueue },
    { name: 'intellmeDeletionQueue', queue: intellmeDeletionQueue },
    { name: 'atlasExportQueue', queue: atlasExportQueue },
    { name: 'livingReportRevisionQueue', queue: livingReportRevisionQueue },
  ];

  for (const { name, queue } of allQueues) {
    it(`${name} uses age/count cleanup objects for removeOnComplete`, () => {
      const opts = queue.defaultJobOptions;
      expect(opts?.removeOnComplete).toBeDefined();
      expect(typeof opts?.removeOnComplete).toBe('object');
      expect(opts?.removeOnComplete).toHaveProperty('age');
      expect(opts?.removeOnComplete).toHaveProperty('count');
    });

    it(`${name} uses age/count cleanup objects for removeOnFail`, () => {
      const opts = queue.defaultJobOptions;
      expect(opts?.removeOnFail).toBeDefined();
      expect(typeof opts?.removeOnFail).toBe('object');
      expect(opts?.removeOnFail).toHaveProperty('age');
      expect(opts?.removeOnFail).toHaveProperty('count');
    });
  }
});
