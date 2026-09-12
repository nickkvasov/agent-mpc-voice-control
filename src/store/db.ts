import type { ActivityEntry } from '../activity/record-writer.ts';
import type { VideoReference } from './video-reference.ts';

/**
 * Persistence boundary. The browser implementation is IndexedDB; the interface
 * exists so the invariants above it can be tested without a browser, and so the
 * application has exactly one owner of what is persisted (IMMUNE-N).
 *
 * The queue is deliberately absent: it is session state and is not required to
 * survive a reload (see data-model.md).
 */

/**
 * One instruction from the person and what became of it (FR-041 — the person
 * can clear this history). No audio is stored: only the recognised text
 * (FR-043).
 */
export interface PersistedCommand {
  readonly commandId: string;
  readonly modality: 'voice' | 'text';
  readonly rawText: string;
  readonly interpretation: string;
  readonly route: 'local_matcher' | 'agent';
  readonly receivedAt: number;
  readonly outcome: 'applied' | 'partially_applied' | 'refused' | 'cancelled' | 'awaiting_confirmation';
  /** Required and non-empty whenever `outcome` is `refused` (FR-034, SC-009). */
  readonly refusalReason: string | null;
}
export interface Collection {
  readonly collectionId: string;
  readonly name: string;
  readonly videoIds: readonly string[];
  readonly createdAt: number;
}

export interface QuotaState {
  /** `null` means not known — never displayed as a confident zero (IMMUNE-U). */
  readonly searchCallsRemaining: number | null;
  readonly resetsAt: number | null;
  readonly lastKnownAt: number;
}

export interface PersistedStores {
  videoReferences: KeyedStore<VideoReference>;
  collections: KeyedStore<Collection>;
  /** Missing from this interface until the Phase 2 Gate C review found it. */
  commands: ClearableStore<PersistedCommand>;
  activityRecords: AppendStore<ActivityEntry>;
  quotaState: SingletonStore<QuotaState>;
}

export interface KeyedStore<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<readonly T[]>;
}

export interface AppendStore<T> {
  append(value: T): Promise<void>;
  all(): Promise<readonly T[]>;
}

export interface SingletonStore<T> {
  read(): Promise<T | undefined>;
  write(value: T): Promise<void>;
}

/** An append store the person can empty, because FR-041 requires it. */
export interface ClearableStore<T> extends AppendStore<T> {
  clear(): Promise<void>;
}

export const DB_NAME = 'voice-video-control';
export const DB_VERSION = 1;
export const OBJECT_STORES = ['videoReferences', 'collections', 'commands', 'activityRecords', 'quotaState'] as const;

export type ObjectStoreName = (typeof OBJECT_STORES)[number];

function memKeyed<T>(): KeyedStore<T> {
  const m = new Map<string, T>();
  return {
    get: async (k) => m.get(k),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    all: async () => [...m.values()],
  };
}

function memAppend<T>(): AppendStore<T> {
  const a: T[] = [];
  return { append: async (v) => void a.push(v), all: async () => a };
}

function memClearable<T>(): ClearableStore<T> {
  let a: T[] = [];
  return {
    append: async (v) => void a.push(v),
    all: async () => a,
    clear: async () => void (a = []),
  };
}

function memSingleton<T>(): SingletonStore<T> {
  let v: T | undefined;
  return { read: async () => v, write: async (next) => void (v = next) };
}

/**
 * In-memory stores with the same contract as the persisted ones. Used by tests
 * and as the explicit fallback when IndexedDB is unavailable — a fallback the
 * caller is told about rather than one that silently loses the person's data.
 */
export function createInMemoryStores(): PersistedStores {
  return {
    videoReferences: memKeyed<VideoReference>(),
    collections: memKeyed<Collection>(),
    commands: memClearable<PersistedCommand>(),
    activityRecords: memAppend<ActivityEntry>(),
    quotaState: memSingleton<QuotaState>(),
  };
}
