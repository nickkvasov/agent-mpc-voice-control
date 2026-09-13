import { ActivityRecorder, createInMemoryActivityStore } from './record-writer.ts';

/**
 * THE activity recorder. One per page.
 *
 * Found in Phase 9: `App.tsx` and `mcp/provider.tsx` each constructed their
 * own, so once the provider was mounted, calls refused before a handler would
 * have been written to a record nobody displays — two owners of the evidence
 * surface (IMMUNE-N). Both now import this.
 */
export const recorder = new ActivityRecorder(createInMemoryActivityStore());
