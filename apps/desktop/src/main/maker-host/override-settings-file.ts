import fs from 'node:fs';
import { readBoundedFileNoFollowSync } from '../utils/readBoundedFile.js';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

// Process-local comparison keys: restarting invalidates all outstanding expectations.
const revisionKey = randomBytes(32);

export type OverrideSettingsSnapshot<T> =
  | (OverrideSettingsState<T> & { status: 'ready'; revision: string })
  | { status: 'unreadable'; revision: null };

export interface OverrideSettingsMutation<T> {
  set?: Partial<T>;
  clear?: Array<keyof T>;
}
/** Internal locked writer context. Raw overrides never enter the public snapshot. */
type OverrideSettingsMutationFactory<T> = (current: OverrideSettingsState<T>, overrides: Readonly<Partial<T> & Record<string, unknown>>) => OverrideSettingsMutation<T>;

export interface OverrideSettingsCommitOptions {
  expectedRevision?: string;
  /** Recheck authorization/owner after acquiring the actual file lock. */
  assertCurrent?: () => void;
}

/** Deliberately contains no path, raw contents or parser detail. */
export class OverrideSettingsError extends Error {
  constructor(readonly code: 'CONFLICT' | 'UNREADABLE' | 'BUSY' | 'SCOPE_CHANGED') {
    super(`Settings ${code.toLowerCase()}`);
  }
}

import { withCrossProcessLock } from '../device-link/crossProcessLock.js';

interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface OverrideSettingsState<T> {
  value: T;
  isCustomized: boolean;
  defaults: T;
  customizedKeys: string[];
}

export interface OverrideSettingsFile<T> {
  read(): T;
  readState(): OverrideSettingsState<T>;
  /** Fresh, side-effect-free inspection. Never repairs/removes a bad file. */
  inspect(): OverrideSettingsSnapshot<T>;
  /** Explicit set/clear and CAS execute under the SAME lock as legacy atomic writers. */
  commitAtomic(
    mutation: OverrideSettingsMutation<T> | OverrideSettingsMutationFactory<T>,
    options?: OverrideSettingsCommitOptions,
  ): Promise<OverrideSettingsSnapshot<T> & { status: 'ready' }>;
  onChanged(listener: () => void): () => void;
  writePatch(patch: Partial<T>, options?: { preserveDefaults?: boolean }): void;
  /** 跨进程锁内强制现读盘上 overrides，再合并 patch 并原子替换文件。 */
  writePatchAtomic(patch: Partial<T>, options?: { preserveDefaults?: boolean }): Promise<void>;
  /** 在同一把跨进程锁内基于最新磁盘快照计算并写入 patch。 */
  updateAtomic(
    updater: (current: OverrideSettingsState<T>) => Partial<T>,
    options?: { preserveDefaults?: boolean },
  ): Promise<T>;
  reset(): T;
  /** 跨进程锁内删除 override 文件。 */
  resetAtomic(): Promise<T>;
  /**
   * 文件被进程外修改(用户/agent 手改配置)时失效缓存,下次 read 现读。
   * mtime 守卫:文件没变时零开销(一次 stat),不重读不重复打 loaded 日志。
   * 支持"直接改文件即生效"语义的 store 在读取入口调用;不调用 = 原缓存语义。
   */
  invalidateIfChanged(): void;
}

interface CachedState<T> extends OverrideSettingsState<T> {
  overrides: Record<string, unknown>;
  readStatus: 'missing' | 'readable' | 'unreadable';
}

/**
 * Atomic mutations use the ordinary/advisory lock tier and still require the
 * lock to be held. `scopeKey` guards owner/session drift separately; neither
 * concern is an authorization decision that should inherit the plugin
 * security-boundary lock's process-identity and durable-recovery machinery.
 */
export function createOverrideSettingsFile<T>(options: {
  filePath: () => string;
  defaults: T | (() => T);
  normalize: (raw: unknown) => T;
  mergeOverrides?: (args: {
    patch: Partial<T>;
    next: T;
    defaults: T;
    overrides: Record<string, unknown>;
  }) => Record<string, unknown>;
  log: Logger;
  label: string;
  /** owner/session 跨 await 切换时让原子写 fail closed。 */
  scopeKey?: () => string;
  /** 读写文件的大小硬上限；超限时拒绝读取或落盘，避免主进程无界分配。 */
  maxBytes?: number;
  /** 读取/解析失败时保留原文件并拒绝普通写入；reset 仍可显式恢复。 */
  preserveUnreadableFile?: boolean;
  /** 设置值可能含敏感数据时，仅记录加载状态，不把 normalized value 写入日志。 */
  logLoadedValue?: boolean;
  /** 读取错误可能带出原文件片段时，不把错误详情写入日志。 */
  logReadErrorDetails?: boolean;
  /** Opted-in domains disallow unlocked legacy writers and suppress settings/path logs. */
  atomicOnly?: boolean;
  validateOverrides?: (overrides: Record<string, unknown>) => void;
}): OverrideSettingsFile<T> {
  const listeners = new Set<() => void>();
  let atomicDepth = 0;
  let cached: CachedState<T> | null = null;
  let cachedResolvedPath: string | null = null;
  /** 缓存装载时文件的 mtimeMs;null = 装载时文件不存在(默认态)。 */
  let cachedFileMtimeMs: number | null = null;

  const defaults = (): T =>
    clone(typeof options.defaults === 'function' ? (options.defaults as () => T)() : options.defaults);

  /** 当前文件 mtimeMs;文件不存在/不可 stat 时 null(与"无文件"同态)。 */
  function statFileMtimeMs(): number | null {
    try {
      return fs.statSync(options.filePath()).mtimeMs;
    } catch {
      return null;
    }
  }

  function readState(): OverrideSettingsState<T> {
    if (options.atomicOnly) {
      const snapshot = inspect();
      if (snapshot.status !== 'ready') throw new OverrideSettingsError('UNREADABLE');
      return { value: snapshot.value, defaults: snapshot.defaults, isCustomized: snapshot.isCustomized, customizedKeys: snapshot.customizedKeys };
    }
    invalidateIfPathChanged();
    if (cached) return toPublicState(cached);
    const file = options.filePath();
    cachedResolvedPath = file;
    let readStatus: CachedState<T>['readStatus'] = 'missing';
    try {
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file);
        if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
          throw new Error(`file exceeds ${options.maxBytes} byte limit`);
        }
        const text = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(text);
        if (options.preserveUnreadableFile && !isLoggableObject(parsed)) {
          throw new Error('settings file root must be an object');
        }
        const overrides = isLoggableObject(parsed) ? parsed : {};
        cachedFileMtimeMs = stat.mtimeMs;
        cached = {
          value: options.normalize({ ...defaults(), ...overrides }),
          isCustomized: Object.keys(overrides).length > 0,
          defaults: defaults(),
          customizedKeys: Object.keys(overrides),
          overrides,
          readStatus: 'readable',
        };
        options.log.info(`${options.label} settings loaded`, {
          ...(options.logLoadedValue === false
            ? {}
            : isLoggableObject(cached.value)
              ? cached.value
              : { value: cached.value }),
          path: file,
          isCustomized: cached.isCustomized,
        });
        return toPublicState(cached);
      }
    } catch (err) {
      if (options.preserveUnreadableFile) readStatus = 'unreadable';
      options.log.warn(`${options.label} settings read failed; falling back to defaults`, {
        ...(options.logReadErrorDetails === false
          ? {}
          : { error: err instanceof Error ? err.message : String(err) }),
        path: file,
      });
      if (!options.preserveUnreadableFile) {
        try {
          fs.unlinkSync(file);
        } catch {
          // no-op
        }
      }
    }

    // 保留坏文件时记住它的 mtime，避免每次读取重复解析/刷日志；用户修复后
    // invalidateIfChanged 会看到 mtime 变化并自动重试。
    cachedFileMtimeMs = readStatus === 'unreadable' ? statFileMtimeMs() : null;
    cached = {
      value: defaults(),
      isCustomized: false,
      defaults: defaults(),
      customizedKeys: [],
      overrides: {},
      readStatus,
    };
    return toPublicState(cached);
  }

  function inspect(): OverrideSettingsSnapshot<T> {
    const file = options.filePath();
    const currentDefaults = defaults();
    let overrides: Record<string, unknown> = {};
    let readStatus: CachedState<T>['readStatus'] = 'missing';
    try {
      let text: string | undefined;
      try {
        const bytes = readBoundedFileNoFollowSync(file, options.maxBytes ?? 64 * 1024);
        if (bytes === null) return { status: 'unreadable', revision: null };
        text = bytes.toString('utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (text !== undefined) {
        const parsed: unknown = JSON.parse(text);
        if (!isLoggableObject(parsed)) throw new Error('invalid settings');
        overrides = parsed;
        options.validateOverrides?.(overrides);
        readStatus = 'readable';
      }
      const state: CachedState<T> = {
        value: options.normalize({ ...currentDefaults, ...overrides }),
        defaults: currentDefaults,
        customizedKeys: Object.keys(overrides),
        isCustomized: Object.keys(overrides).length > 0,
        overrides,
        readStatus,
      };
      cached = state;
      cachedResolvedPath = file;
      const revision = createHmac('sha256', revisionKey)
        .update(stableStringify({ file, scope: options.scopeKey?.(), defaults: currentDefaults, overrides }))
        .digest('base64url');
      return { ...clone(toPublicState(state)), status: 'ready', revision };
    } catch {
      return { status: 'unreadable', revision: null };
    }
  }

  async function commitAtomic(
    mutation: OverrideSettingsMutation<T> | OverrideSettingsMutationFactory<T>,
    commitOptions: OverrideSettingsCommitOptions = {},
  ): Promise<OverrideSettingsSnapshot<T> & { status: 'ready' }> {
    const file = options.filePath();
    const scope = options.scopeKey?.();
    commitOptions.assertCurrent?.();
    fs.mkdirSync(pathDirname(file), { recursive: true });
    return withCrossProcessLock(`${file}.lock`, { label: `${options.label}-settings`, waitMs: 12_000 }, async (lock) => {
      if (!lock.held) throw new OverrideSettingsError('BUSY');
      if (options.filePath() !== file || options.scopeKey?.() !== scope) {
        throw new OverrideSettingsError('SCOPE_CHANGED');
      }
      commitOptions.assertCurrent?.();
      const before = inspect();
      if (before.status !== 'ready') throw new OverrideSettingsError('UNREADABLE');
      if (commitOptions.expectedRevision !== undefined && before.revision !== commitOptions.expectedRevision) {
        throw new OverrideSettingsError('CONFLICT');
      }
      const change = typeof mutation === 'function' ? mutation(before, clone(cached!.overrides) as Partial<T> & Record<string, unknown>) : mutation;
      if (!Object.keys(change.set ?? {}).length && !change.clear?.length) {
        commitOptions.assertCurrent?.();
        return before;
      }
      const overrides = { ...cached!.overrides };
      for (const key of change.clear ?? []) delete overrides[String(key)];
      Object.assign(overrides, change.set ?? {});
      options.validateOverrides?.(overrides);
      // 在发布前完成所有可能失败的解释和回执构造；rename 后不再依赖磁盘回读。
      const prepared = prepareState(overrides, before.defaults);
      const receipt = { ...clone(toPublicState(prepared)), status: 'ready' as const,
        revision: createHmac('sha256', revisionKey).update(stableStringify({ file, scope, defaults: before.defaults, overrides })).digest('base64url') };
      commitOptions.assertCurrent?.();
      atomicDepth++;
      try { writeOverrides(overrides, prepared); } finally { atomicDepth--; }
      return receipt;
    });
  }

  function notifyChanged(): void {
    for (const listener of listeners) {
      try { listener(); } catch { /* Subscribers never turn a saved write into a failure. */ }
    }
  }

  function invalidateIfChanged(): void {
    invalidateIfPathChanged();
    if (!cached) return;
    if (statFileMtimeMs() !== cachedFileMtimeMs) {
      cached = null;
      cachedFileMtimeMs = null;
    }
  }

  function writePatch(patch: Partial<T>, writeOptions?: { preserveDefaults?: boolean }): T {
    if (options.atomicOnly && atomicDepth === 0) throw new OverrideSettingsError('BUSY');
    const current = readWritableState();
    const next = options.normalize({ ...current.value, ...patch });
    const currentDefaults = defaults();
    const currentOverrides = cached?.overrides ?? {};
    const nextOverrides = options.mergeOverrides
      ? options.mergeOverrides({
          patch,
          next,
          defaults: currentDefaults,
          overrides: currentOverrides,
        })
      : (() => {
          const overrides = { ...currentOverrides };
          for (const key of Object.keys(patch) as Array<keyof T>) {
            const normalizedValue = next[key];
            if (!writeOptions?.preserveDefaults && isEqual(normalizedValue, currentDefaults[key])) {
              delete overrides[String(key)];
            } else {
              overrides[String(key)] = normalizedValue;
            }
          }
          return overrides;
        })();
    return writeOverrides(nextOverrides);
  }

  async function writePatchAtomic(
    patch: Partial<T>,
    writeOptions?: { preserveDefaults?: boolean },
  ): Promise<void> {
    const file = options.filePath();
    const scopeKey = options.scopeKey?.();
    fs.mkdirSync(pathDirname(file), { recursive: true });
    await withCrossProcessLock(
      `${file}.lock`,
      { label: `${options.label}-settings`, waitMs: 12_000 },
      async (status) => {
        if (!status.held) {
          throw new Error(`${options.label} settings are busy in another process`);
        }
        if (options.filePath() !== file || options.scopeKey?.() !== scopeKey) {
          throw new Error(
            `${options.label} settings scope changed while waiting for the write lock`,
          );
        }
        invalidate();
        atomicDepth++;
        try { writePatch(patch, writeOptions); } finally { atomicDepth--; }
      },
    );
  }

  async function updateAtomic(
    updater: (current: OverrideSettingsState<T>) => Partial<T>,
    writeOptions?: { preserveDefaults?: boolean },
  ): Promise<T> {
    const file = options.filePath();
    const scopeKey = options.scopeKey?.();
    fs.mkdirSync(pathDirname(file), { recursive: true });
    return withCrossProcessLock(
      `${file}.lock`,
      { label: `${options.label}-settings`, waitMs: 12_000 },
      async (status) => {
        if (!status.held) {
          throw new Error(`${options.label} settings are busy in another process`);
        }
        if (options.filePath() !== file || options.scopeKey?.() !== scopeKey) {
          throw new Error(
            `${options.label} settings scope changed while waiting for the write lock`,
          );
        }
        invalidate();
        const current = readWritableState();
        atomicDepth++;
        try { return writePatch(updater(current), writeOptions); } finally { atomicDepth--; }
      },
    );
  }

  function prepareState(overrides: Record<string, unknown>, currentDefaults = defaults()): CachedState<T> {
    return {
      value: options.normalize({ ...currentDefaults, ...overrides }),
      defaults: currentDefaults,
      isCustomized: Object.keys(overrides).length > 0,
      customizedKeys: Object.keys(overrides),
      overrides,
      readStatus: Object.keys(overrides).length > 0 ? 'readable' : 'missing',
    };
  }

  function writeOverrides(overrides: Record<string, unknown>, prepared = prepareState(overrides)): T {
    // 所有已选择校验的领域共用最终落盘闸门；未配置 validator 的存量 store 保持原语义。
    options.validateOverrides?.(overrides);
    const file = options.filePath();
    const result = clone(prepared.value);
    const serialized = JSON.stringify(overrides, null, 2);
    if (options.maxBytes !== undefined && Buffer.byteLength(serialized, 'utf-8') > options.maxBytes) {
      throw new Error(`file exceeds ${options.maxBytes} byte limit`);
    }
    fs.mkdirSync(pathDirname(file), { recursive: true });
    if (Object.keys(overrides).length === 0) {
      try { fs.unlinkSync(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } else {
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tmp, serialized, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
        fs.renameSync(tmp, file);
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* rename 已消耗临时文件。 */ }
      }
    }
    cachedFileMtimeMs = statFileMtimeMs();
    cachedResolvedPath = file;
    cached = prepared;
    notifyChanged();
    return result;
  }

  function reset(): T {
    if (options.atomicOnly && atomicDepth === 0) throw new OverrideSettingsError('BUSY');
    const file = options.filePath();
    const resetDefaults = defaults();
    const result = clone(resetDefaults);
    cachedResolvedPath = file;
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      options.log.warn(`${options.label} settings reset failed`, options.atomicOnly ? {} : {
        error: err instanceof Error ? err.message : String(err),
        path: file,
      });
      throw err;
    }
    cachedFileMtimeMs = null;
    cached = {
      value: resetDefaults,
      isCustomized: false,
      defaults: resetDefaults,
      customizedKeys: [],
      overrides: {},
      readStatus: 'missing',
    };
    if (!options.atomicOnly) options.log.info(`${options.label} settings reset to defaults`, { path: file });
    notifyChanged();
    return result;
  }

  async function resetAtomic(): Promise<T> {
    const file = options.filePath();
    const scopeKey = options.scopeKey?.();
    fs.mkdirSync(pathDirname(file), { recursive: true });
    return withCrossProcessLock(
      `${file}.lock`,
      { label: `${options.label}-settings`, waitMs: 12_000 },
      async (status) => {
        if (!status.held) {
          throw new Error(`${options.label} settings are busy in another process`);
        }
        if (options.filePath() !== file || options.scopeKey?.() !== scopeKey) {
          throw new Error(
            `${options.label} settings scope changed while waiting for the write lock`,
          );
        }
        invalidate();
        atomicDepth++;
        try { return reset(); } finally { atomicDepth--; }
      },
    );
  }

  return {
    read: () => readState().value,
    readState,
    inspect,
    commitAtomic,
    onChanged: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    writePatch,
    writePatchAtomic,
    updateAtomic,
    reset,
    resetAtomic,
    invalidateIfChanged,
  };

  function invalidate(): void {
    cached = null;
    cachedFileMtimeMs = null;
    cachedResolvedPath = null;
  }

  function invalidateIfPathChanged(): void {
    const currentPath = options.filePath();
    if (cachedResolvedPath === null || cachedResolvedPath === currentPath) return;
    cached = null;
    cachedFileMtimeMs = null;
    cachedResolvedPath = currentPath;
  }

  function readWritableState(): OverrideSettingsState<T> {
    const state = readState();
    if (cached?.readStatus === 'unreadable') {
      throw new Error(`${options.label} settings file is unreadable; refusing to overwrite it`);
    }
    return state;
  }
}

function pathDirname(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return slash < 0 ? '.' : filePath.slice(0, slash);
}

function toPublicState<T>(state: CachedState<T>): OverrideSettingsState<T> {
  return {
    value: state.value,
    isCustomized: state.isCustomized,
    defaults: state.defaults,
    customizedKeys: state.customizedKeys,
  };
}

function clone<T>(value: T): T {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.parse(JSON.stringify(value)) as T;
  }
  return value;
}

function isEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (isLoggableObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function isLoggableObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
