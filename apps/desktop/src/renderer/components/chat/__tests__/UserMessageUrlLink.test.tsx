// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../../__tests__/desktopPreferencesHarness';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/features/right-sidebar/lib/openInSidebarBrowser', () => ({
  openUrlInSidebarBrowser: vi.fn(async () => undefined),
  pathToFileUrl: (path: string) => `file://${path}`,
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SessionNavigationModeProvider } from '@/features/cc-agent/embeddedSessionNavigation';
import { openUrlInSidebarBrowser } from '@/features/right-sidebar/lib/openInSidebarBrowser';
import {
  _resetLinkOpenPreferenceForTests,
  useLinkOpenPreference,
} from '@/hooks/useLinkOpenPreference';
import { UserMessageUrlLink } from '../UserMessageUrlLink';

let host: ReturnType<typeof installDesktopPreferencesHarness>;
const URL = 'https://example.com/path';
const LOCAL_URL = 'http://localhost:3000/app';
const openExternal = vi.fn(async (url: string) => {
  void url;
  return { success: true };
});

function WebPreferenceButton({ value }: { value: 'sidebar' | 'external' }) {
  const { setPreference } = useLinkOpenPreference('web');
  return (
    <button type="button" onClick={() => setPreference(value)}>
      use {value}
    </button>
  );
}

describe('UserMessageUrlLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    _resetLinkOpenPreferenceForTests();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { openExternal },
    });
    host = installDesktopPreferencesHarness({});
  });

  it('opens public web URLs in the system browser by default', async () => {
    render(<UserMessageUrlLink url={URL} sessionId="session-a" />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(URL));
    expect(openUrlInSidebarBrowser).not.toHaveBeenCalled();
  });

  it('opens localhost URLs in the current session sidebar by default', async () => {
    render(<UserMessageUrlLink url={LOCAL_URL} sessionId="session-a" />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => expect(openUrlInSidebarBrowser).toHaveBeenCalledWith('session-a', LOCAL_URL));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens the URL in the current session sidebar when sidebar is preferred', async () => {
    host.external({ webLinkOpenPreference: 'sidebar' });
    render(<UserMessageUrlLink url={URL} sessionId="session-a" />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => expect(openUrlInSidebarBrowser).toHaveBeenCalledWith('session-a', URL));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('uses a newly selected external preference without remounting', async () => {
    host.external({ webLinkOpenPreference: 'sidebar' });
    render(
      <>
        <WebPreferenceButton value="external" />
        <UserMessageUrlLink url={URL} sessionId="session-a" />
      </>,
    );

    const existingLink = screen.getByRole('link');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'use external' }));
      await settleDesktopPreferences();
    });
    expect(host.snapshot()).toMatchObject({ value: { webLinkOpenPreference: 'external' }, customizedKeys: ['webLinkOpenPreference'] });
    expect(screen.getByRole('link')).toBe(existingLink);
    fireEvent.click(existingLink);

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(URL));
    expect(openUrlInSidebarBrowser).not.toHaveBeenCalled();
  });

  it('falls back to the external browser without session context', async () => {
    render(<UserMessageUrlLink url={URL} />);

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(URL));
    expect(openUrlInSidebarBrowser).not.toHaveBeenCalled();
  });

  it('uses the visible session bucket for sidebar-embedded messages', async () => {
    host.external({ webLinkOpenPreference: 'sidebar' });
    render(
      <SessionNavigationModeProvider mode="sidebar-embedded" sidebarTargetSessionId="lead-a">
        <UserMessageUrlLink url={URL} sessionId="worker-a" />
      </SessionNavigationModeProvider>,
    );

    fireEvent.click(screen.getByRole('link'));

    await waitFor(() => expect(openUrlInSidebarBrowser).toHaveBeenCalledWith('lead-a', URL));
  });

  it('shows the existing open-with menu on right-click', () => {
    render(<UserMessageUrlLink url={URL} sessionId="session-a" />);

    fireEvent.contextMenu(screen.getByRole('link'), { clientX: 10, clientY: 20 });

    expect(screen.getByText('chat.markdownRenderer.openInSidebarBrowser')).toBeTruthy();
    expect(screen.getByText('chat.markdownRenderer.openInDefaultBrowser')).toBeTruthy();
    expect(screen.getByText('chat.markdownRenderer.copyLink')).toBeTruthy();
  });

  it('keeps Ctrl-click as a temporary external-browser override', async () => {
    host.external({ webLinkOpenPreference: 'sidebar' });
    render(<UserMessageUrlLink url={URL} sessionId="session-a" />);

    fireEvent.click(screen.getByRole('link'), { ctrlKey: true });

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(URL));
    expect(openUrlInSidebarBrowser).not.toHaveBeenCalled();
  });
});
