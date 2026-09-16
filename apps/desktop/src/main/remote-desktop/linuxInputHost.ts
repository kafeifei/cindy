import { BrowserWindow, screen } from 'electron';
import { insertManagedBrowserText } from '../mcp-integrations/browser-focused-text';
import { openLinuxDisplay } from './linuxDisplay';
import { LinuxDesktopInput, type LinuxInputText } from './linuxInput';
import { checkLinuxInputGuard, openLinuxInputGuard } from './linuxInputGuard';

export async function insertLinuxDesktopText(request: LinuxInputText): Promise<void> {
  await request.validate();
  if (request.pid !== process.pid) {
    await insertManagedBrowserText(request);
    return;
  }
  const window = BrowserWindow.getAllWindows().find((candidate) => {
    if (candidate.isDestroyed()) return false;
    const handle = candidate.getNativeWindowHandle();
    return handle.length >= 4 && handle.readUInt32LE() === request.windowId;
  });
  if (
    !window ||
    !window.isVisible() ||
    !window.isFocused() ||
    window.webContents.isDestroyed() ||
    !window.webContents.isFocused()
  )
    throw new Error('DESKTOP_TEXT_UNSUPPORTED');
  await window.webContents.insertText(request.text);
  await request.validate();
}

export async function openLinuxDesktopInput(
  displayId: string,
  onFailure: () => void,
): Promise<LinuxDesktopInput> {
  const connection = await openLinuxDisplay();
  const bounds = screen
    .getAllDisplays()
    .find((display) => String(display.id) === displayId)?.bounds;
  if (
    !bounds ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > connection.width ||
    bounds.y + bounds.height > connection.height
  )
    throw new Error('DESKTOP_DISPLAY_MISSING');
  const guard = await openLinuxInputGuard(connection.environment, onFailure);
  return new LinuxDesktopInput(
    { ...connection, ...guard, insertText: insertLinuxDesktopText },
    onFailure,
  );
}

export async function readLinuxInputSupport(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    const connection = await openLinuxDisplay();
    await checkLinuxInputGuard(connection.environment);
    return await connection.current();
  } catch {
    return false;
  }
}
