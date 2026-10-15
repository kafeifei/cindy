import { createModelPresentationTestHost } from './modelPresentationTestHost';
import { ensureHostModelPresentationLoaded } from '@/state/hostModelPresentationPreferences';
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
let favoriteHost: ReturnType<typeof createModelPresentationTestHost>;
async function selectFavoritesOwner(id: string | null) {
  favoriteHost.select(id, getDataOwnerGeneration().generation);
  setModelFavoritesOwner(id);
  await ensureHostModelPresentationLoaded();
}
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderShareReceived } from '@cindy/device-link';
import type { ProviderShareReceivedSnapshot } from '../../shared/providerShare';
import type { ProviderShareCommand } from '../../shared/providerShare';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import { __resetForTest, addModelFavorite, listModelFavorites, setModelFavoritesOwner } from '@/state/modelFavorites';
import { providerShareFavoriteSource } from '@/state/providerShareFavorites';
import { ensureProviderShareReceivedStarted, resetProviderShareStoreForTests } from '@/features/provider-share/providerShareStore';

vi.mock('@/hooks/useDeviceProviders', () => ({ getCachedDeviceProviders: () => null }));
vi.mock('@/lib/remoteCatalogSnapshot', () => ({ refreshRemoteCatalogSnapshot: vi.fn(async () => {}) }));
const share: ProviderShareReceived = {
  shareId: 's1', memberId: 'm1', providerId: 'anthropic', providerLabel: 'Anthropic', hostDeviceId: 'host',
  deviceName: 'Host', owner: { displayName: 'Owner', avatarUrl: null, region: 'global' },
  status: 'active', hostOnline: true, hostCapable: true,
};
let push: (list: ProviderShareReceived[]) => void;
let snapshot: ProviderShareReceivedSnapshot;
let readSnapshot: () => Promise<ProviderShareReceivedSnapshot>;
let commands: ProviderShareCommand[];
const tick = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(async () => {
  vi.useFakeTimers();
  resetProviderShareStoreForTests();
  __resetForTest();
  window.localStorage.clear();
  favoriteHost = createModelPresentationTestHost(window.localStorage);
  favoriteHost.install();
  setDataOwnerGeneration('recipient', 1);
  await selectFavoritesOwner('recipient');
  snapshot = { ownerStamp: { dataOwnerId: 'recipient', ownerGeneration: 1 }, confirmedRegions: [], received: [] };
  readSnapshot = async () => snapshot;
  commands = [];
  Object.assign(window, { electronAPI: { ...window.electronAPI, providerShare: {
    command: (command: ProviderShareCommand) => {
      commands.push(command);
      return command.action === 'received-snapshot' ? readSnapshot() : Promise.resolve(snapshot.received);
    },
    onReceivedChanged: (listener: typeof push) => { push = listener; return () => {}; },
  } } });
  await addModelFavorite({ providerId: providerShareFavoriteSource(share), modelId: 'opus', agent: 'cc' });
});
afterEach(() => { resetProviderShareStoreForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('retries failed cleanup with backoff without another share push and stops after success', async () => {
  snapshot = { ...snapshot, confirmedRegions: ['global'], received: [] };
  favoriteHost.options.failWrite = true;
  const writes = vi.spyOn(favoriteHost.api, 'mutate');
  ensureProviderShareReceivedStarted();
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  expect(writes).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(writes).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(writes).toHaveBeenCalledTimes(2);
  writes.mockRestore(); favoriteHost.options.failWrite = false;
  await vi.advanceTimersByTimeAsync(1);
  expect(listModelFavorites()).toEqual([]);
  const requestCount = commands.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(commands).toHaveLength(requestCount);
});

it('uses persisted favorite regions after restart even when the main discovery marker was removed', async () => {
  snapshot = { ...snapshot, confirmedRegions: ['global'], received: [] };
  favoriteHost.options.failWrite = true;
  const writes = vi.spyOn(favoriteHost.api, 'mutate');
  ensureProviderShareReceivedStarted();
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  writes.mockRestore(); favoriteHost.options.failWrite = false;
  resetProviderShareStoreForTests();
  await selectFavoritesOwner(null);
  await selectFavoritesOwner('recipient');
  snapshot = { ...snapshot, confirmedRegions: [], received: [] };
  commands = [];
  ensureProviderShareReceivedStarted();
  await tick();
  expect(commands).toContainEqual({ action: 'received-snapshot', favoriteRecovery: {
    ownerStamp: { dataOwnerId: 'recipient', ownerGeneration: 1 }, regions: ['global'],
  } });
  expect(listModelFavorites()).toHaveLength(1);
  snapshot = { ...snapshot, confirmedRegions: ['global'] };
  await vi.advanceTimersByTimeAsync(5_000);
  expect(listModelFavorites()).toEqual([]);
});

it('rereads the latest membership instead of retrying a stale deletion', async () => {
  snapshot = { ...snapshot, confirmedRegions: ['global'] };
  favoriteHost.options.failWrite = true;
  const writes = vi.spyOn(favoriteHost.api, 'mutate');
  ensureProviderShareReceivedStarted();
  await tick();
  writes.mockRestore(); favoriteHost.options.failWrite = false;
  snapshot = { ...snapshot, received: [share] };
  await vi.advanceTimersByTimeAsync(5_000);
  expect(listModelFavorites()).toHaveLength(1);
  const requestCount = commands.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(commands).toHaveLength(requestCount);
});

it('does not run an earlier account retry after switching owners', async () => {
  readSnapshot = vi.fn(async () => { throw new Error('unavailable'); });
  ensureProviderShareReceivedStarted();
  await tick();
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  setDataOwnerGeneration('other', 2);
  await selectFavoritesOwner('other');
  await addModelFavorite({ providerId: providerShareFavoriteSource(share), modelId: 'opus', agent: 'cc' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readSnapshot).toHaveBeenCalledTimes(1);
  expect(listModelFavorites()).toHaveLength(1);
});

it('retries when temporarily unreadable storage prevents discovering favorite regions', async () => {
  snapshot = { ...snapshot, confirmedRegions: ['global'] };
  favoriteHost.options.failRead = true;
  await selectFavoritesOwner('recipient');
  ensureProviderShareReceivedStarted();
  await tick();
  favoriteHost.options.failRead = false;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(commands).toContainEqual({ action: 'received-snapshot', favoriteRecovery: {
    ownerStamp: { dataOwnerId: 'recipient', ownerGeneration: 1 }, regions: ['global'],
  } });
  expect(listModelFavorites()).toEqual([]);
});

it('cleans favorites without opening a picker, only after Main confirms the last share was removed', async () => {
  ensureProviderShareReceivedStarted();
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  push([]); // 断线时的空推送。
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  snapshot = { ...snapshot, confirmedRegions: ['global'], received: [{ ...share, status: 'paused', hostOnline: false }] };
  push([...snapshot.received]);
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  snapshot = { ...snapshot, received: [] };
  push([]);
  await tick();
  expect(listModelFavorites()).toEqual([]);
});

it('does not apply a superseded membership reply or an earlier account response', async () => {
  let finish!: (snapshot: ProviderShareReceivedSnapshot) => void;
  readSnapshot = () => new Promise((resolve) => { finish = resolve; });
  ensureProviderShareReceivedStarted();
  await tick();
  const stale = finish;
  readSnapshot = async () => ({ ...snapshot, confirmedRegions: ['global'], received: [share] });
  push([share]);
  await tick();
  stale({ ...snapshot, confirmedRegions: ['global'], received: [] });
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
  readSnapshot = () => new Promise((resolve) => { finish = resolve; });
  push([]);
  setDataOwnerGeneration('other', 2);
  await selectFavoritesOwner('other');
  await addModelFavorite({ providerId: providerShareFavoriteSource(share), modelId: 'opus', agent: 'cc' });
  finish({ ...snapshot, confirmedRegions: ['global'], received: [] });
  await tick();
  expect(listModelFavorites()).toHaveLength(1);
});
