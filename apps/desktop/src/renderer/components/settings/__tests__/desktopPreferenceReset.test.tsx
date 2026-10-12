// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ reset: vi.fn(), set: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/toast', () => ({ toast: { success: h.success, error: h.error } }));
vi.mock('@/components/ui/tooltip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/hooks/useComposerSendShortcutPreference', () => ({ getComposerModifierShortcutLabel: () => 'Ctrl+Enter', useComposerSendShortcutPreference: () => ({ preference: 'modifier-enter', isCustomized: true, setPreference: h.set, resetPreference: h.reset }) }));
vi.mock('@/hooks/useLinkOpenPreference', () => ({ useLinkOpenPreference: () => ({ preference: 'sidebar', isCustomized: true, setPreference: h.set, resetPreference: h.reset }) }));
vi.mock('@/hooks/useStreamFadePreference', () => ({ useStreamFadePreference: () => ({ preference: 'off', isCustomized: true, setPreference: h.set, resetPreference: h.reset }) }));
vi.mock('@/hooks/useMessageNavRailPreference', () => ({ useMessageNavRailPreference: () => ({ enabled: false, isCustomized: true, setEnabled: h.set, resetPreference: h.reset }) }));
import { ComposerSendShortcutSection } from '../ComposerSendShortcutSection';
import { LinkOpenSection } from '../LinkOpenSection';
import { StreamFadeSection } from '../StreamFadeSection';
import { MessageNavRailCell } from '../MessageNavRailCell';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('desktop preference reset acknowledgement', () => {
  it.each([ComposerSendShortcutSection, LinkOpenSection, StreamFadeSection, MessageNavRailCell])('reports success only after a successful Host reset in %s', async Component => {
    Object.assign(window, { electronAPI: { platform: 'win32' } });
    let finish!: (saved: boolean) => void;
    h.reset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<Component />);
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.defaults.restore' })[0]);
    expect(h.success).not.toHaveBeenCalled();
    await act(async () => { finish(true); });
    expect(h.set).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
    if (Component === MessageNavRailCell) expect(h.success).not.toHaveBeenCalled();
    else expect(h.success).toHaveBeenCalledWith('settings.defaults.restored');
  });
  it.each([ComposerSendShortcutSection, LinkOpenSection, StreamFadeSection, MessageNavRailCell])('does not claim reset success before Host receipt in %s', async Component => {
    Object.assign(window, { electronAPI: { platform: 'win32' } });
    let finish!: (saved: boolean) => void;
    h.reset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<Component />);
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.defaults.restore' })[0]);
    expect(h.reset).toHaveBeenCalledOnce(); expect(h.set).not.toHaveBeenCalled(); expect(h.success).not.toHaveBeenCalled();
    await act(async () => { finish(false); });
    expect(h.success).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledWith('hostSettings.saveFailed');
  });
});
