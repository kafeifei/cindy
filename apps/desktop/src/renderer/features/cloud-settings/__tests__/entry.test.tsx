// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSettingsShortcut } from '../CloudSettingsShortcut';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, vars: { name: string }) => `Configure ${vars.name}` }),
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);
function Destination() {
  const location = useLocation();
  return (
    <output>
      {JSON.stringify({ path: location.pathname, query: location.search, state: location.state })}
    </output>
  );
}
it('opens the named instance directly and remembers the previous location', () => {
  render(
    <MemoryRouter initialEntries={['/cc-agent/new?workspace=example']}>
      <Routes>
        <Route
          path="/cc-agent/new"
          element={<CloudSettingsShortcut deviceId="cloud-device-example" name="My cloud" />}
        />
        <Route path="/cloud-settings" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Configure My cloud' }));
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
    path: '/cloud-settings',
    query: '?deviceId=cloud-device-example',
    state: { returnTo: '/cc-agent/new?workspace=example' },
  });
});
