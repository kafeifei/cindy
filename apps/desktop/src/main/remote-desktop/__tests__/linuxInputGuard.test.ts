import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLinuxInputGuard, openLinuxInputGuard } from '../linuxInputGuard';

const fixture = vi.hoisted(() => ({ spawn: vi.fn(), exec: vi.fn() }));
const helper = path.join('/test', 'native', 'remote-desktop', 'linux-input-guard.py');
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/test' } }));
vi.mock('node:fs/promises', () => ({ access: vi.fn(async () => {}) }));
vi.mock('node:child_process', () => ({
  spawn: fixture.spawn,
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: fixture.exec }),
}));

function nativeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: { resume: vi.fn() },
    stdin: Object.assign(new EventEmitter(), {
      destroyed: false,
      writableLength: 0,
      write: vi.fn(),
      end: vi.fn(),
    }),
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(),
  });
  const exit = () => {
    child.exitCode = 0;
    child.emit('exit', 0);
    child.emit('close', 0);
  };
  child.stdin.end.mockImplementation(() => queueMicrotask(exit));
  fixture.spawn.mockImplementation(() => {
    queueMicrotask(() => child.stdout.emit('data', Buffer.from('ready\n')));
    return child;
  });
  return {
    child,
    exit,
    receive: (value: unknown) =>
      child.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`)),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('persistent Linux input helper', () => {
  it('uses one helper connection and acknowledges each command without reconnecting X11', async () => {
    const native = nativeProcess();
    const failure = vi.fn();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, failure);
    const first = guard.command(['getactivewindow']);
    expect(native.child.stdin.write).toHaveBeenLastCalledWith(
      '{"id":1,"args":["getactivewindow"]}\n',
    );
    native.receive({ id: 1, stdout: '42' });
    await expect(first).resolves.toBe('42');
    const second = guard.command(['keydown', 'Control_L']);
    native.receive({ id: 2, stdout: '' });
    await second;
    expect(fixture.spawn).toHaveBeenCalledExactlyOnceWith('/usr/bin/python3', ['-I', helper], {
      env: { DISPLAY: ':77' },
      stdio: 'pipe',
    });
    await guard.close();
    await guard.close();
    expect(native.child.stdin.end).toHaveBeenCalledOnce();
    expect(failure).not.toHaveBeenCalled();
  });

  it('rejects simultaneous native requests rather than growing another queue', async () => {
    const native = nativeProcess();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, vi.fn());
    const first = guard.command(['getactivewindow']);
    await expect(guard.command(['getwindowpid', '42'])).rejects.toThrow('BUSY');
    native.receive({ id: 1, stdout: '42' });
    await first;
    await guard.close();
  });

  it('closes the old helper on abort and never replays its late response or inputs', async () => {
    const native = nativeProcess();
    const failure = vi.fn();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, failure);
    const abort = new AbortController();
    const command = guard.command(['keydown', 'Control_L'], abort.signal);
    const rejected = expect(command).rejects.toThrow('EXPIRED');
    abort.abort();
    await rejected;
    native.receive({ id: 1, stdout: '' });
    await expect(guard.command(['mousemove', '1', '2'])).rejects.toThrow('UNAVAILABLE');
    expect(native.child.stdin.write).toHaveBeenCalledOnce();
    expect(fixture.spawn).toHaveBeenCalledOnce();
    await guard.close();
    expect(failure).not.toHaveBeenCalled();
  });

  it('fails closed on a command timeout without retrying', async () => {
    const native = nativeProcess();
    const failure = vi.fn();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, failure);
    vi.useFakeTimers();
    const rejected = expect(guard.command(['getactivewindow'])).rejects.toThrow('UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(1500);
    await rejected;
    expect(failure).toHaveBeenCalledOnce();
    expect(native.child.stdin.write).toHaveBeenCalledOnce();
    await guard.close();
  });

  it('sanitizes a malformed helper response and ends the lease', async () => {
    const native = nativeProcess();
    const failure = vi.fn();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, failure);
    const rejected = expect(guard.command(['getactivewindow'])).rejects.toThrow(
      /^DESKTOP_INPUT_UNAVAILABLE$/,
    );
    native.receive({ id: 987, stdout: 'private content' });
    await rejected;
    await guard.close();
    expect(failure).toHaveBeenCalledOnce();
  });

  it('rejects oversized writes before they reach the helper', async () => {
    const native = nativeProcess();
    const failure = vi.fn();
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, failure);
    await expect(guard.command(['A'.repeat(32768)])).rejects.toThrow('UNAVAILABLE');
    expect(native.child.stdin.write).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
    await guard.close();
  });

  it('waits for helper exit when the X server becomes unresponsive', async () => {
    const native = nativeProcess();
    native.child.stdin.end.mockImplementation(() => {});
    const guard = await openLinuxInputGuard({ DISPLAY: ':77' }, vi.fn());
    vi.useFakeTimers();
    const stopping = guard.close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(native.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    native.exit();
    await stopping;
  });

  it('checks XTest availability with no input before advertising Linux control', async () => {
    fixture.exec.mockResolvedValue({ stdout: 'ready\n' });
    await expect(checkLinuxInputGuard({ DISPLAY: ':77' })).resolves.toBeUndefined();
    expect(fixture.exec).toHaveBeenCalledWith('/usr/bin/python3', ['-I', helper, '--check'], {
      env: { DISPLAY: ':77' },
      timeout: 1500,
      maxBuffer: 256,
    });
    fixture.exec.mockRejectedValue(new Error('private stderr'));
    await expect(checkLinuxInputGuard({ DISPLAY: ':77' })).rejects.toThrow(
      /^DESKTOP_INPUT_UNAVAILABLE$/,
    );
  });
});
