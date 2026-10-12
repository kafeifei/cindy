// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  state: { value: '', ready: true, unavailable: false, customized: false, revision: 'r1' as string | null, ownerKey: 'owner-a:1' },
  save: vi.fn(), reset: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useUserPrompt', () => ({ useUserPrompt: () => ({ ...fixture.state, setValue: fixture.save, resetValue: fixture.reset }) }));
vi.mock('@/lib/toast', () => ({ toast: { success: fixture.success, error: fixture.error } }));
import { UserPromptSection } from '../UserPromptSection';
const editor = () => screen.getByRole('textbox', { name: 'settings.personalization.ariaLabel' });
const saveButton = () => screen.getByRole('button', { name: 'settings.personalization.save' }) as HTMLButtonElement;
beforeEach(() => {
  vi.resetAllMocks();
  fixture.state = { value: '', ready: true, unavailable: false, customized: false, revision: 'r1', ownerKey: 'owner-a:1' };
  fixture.save.mockResolvedValue(undefined); fixture.reset.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('个性化设置编辑与保存回执', () => {
  it('保留原占位 token 与空白视觉处理', () => {
    render(<UserPromptSection />);
    expect(editor().className).toContain('placeholder:text-[var(--settings-input-placeholder)]');
    expect(editor().className).toContain('placeholder:font-normal');
    expect(editor().className).toContain('placeholder:opacity-45');
  });
  it('Host 保存完成前不显示成功，提交编辑时的 revision', async () => {
    let resolve!: () => void;
    fixture.save.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    render(<UserPromptSection />);
    fireEvent.change(editor(), { target: { value: 'draft' } }); fireEvent.click(saveButton());
    expect(fixture.save).toHaveBeenCalledWith('draft', 'r1'); expect(fixture.success).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);
    resolve(); await waitFor(() => expect(fixture.success).toHaveBeenCalledOnce());
  });
  it('保存失败显示失败反馈，不谎报成功', async () => {
    fixture.save.mockRejectedValueOnce(new Error('fixture failure'));
    render(<UserPromptSection />);
    fireEvent.change(editor(), { target: { value: 'draft' } }); fireEvent.click(saveButton());
    await waitFor(() => expect(fixture.error).toHaveBeenCalledWith('hostSettings.saveFailed'));
    expect(fixture.success).not.toHaveBeenCalled();
  });
  it('恢复默认调用 clear 入口，不把空串当 reset 写回', async () => {
    fixture.state = { ...fixture.state, value: 'custom', customized: true };
    render(<UserPromptSection />); fireEvent.click(screen.getByRole('button', { name: 'hostSettings.reset' }));
    await waitFor(() => expect(fixture.reset).toHaveBeenCalledWith('r1'));
    expect(fixture.save).not.toHaveBeenCalled();
  });
  it('外部更新保留未保存草稿，禁止用新 revision 覆盖', () => {
    const ui = render(<UserPromptSection />);
    fireEvent.change(editor(), { target: { value: 'my draft' } });
    fixture.state = { ...fixture.state, value: 'external', revision: 'r2' }; ui.rerender(<UserPromptSection />);
    expect((editor() as HTMLTextAreaElement).value).toBe('my draft');
    expect(saveButton().disabled).toBe(true); expect(screen.getByRole('status').textContent).toBe('hostSettings.changed');
  });
  it('切换账号立即清除旧草稿', () => {
    const ui = render(<UserPromptSection />);
    fireEvent.change(editor(), { target: { value: 'old owner draft' } });
    fixture.state = { ...fixture.state, value: '', ownerKey: 'owner-b:2', revision: 'r2' }; ui.rerender(<UserPromptSection />);
    expect((editor() as HTMLTextAreaElement).value).toBe(''); expect(saveButton().disabled).toBe(true);
  });
  it('无法读取的设置不能编辑或保存，不把空白当真实默认值', () => {
    fixture.state = { ...fixture.state, ready: false, unavailable: true, revision: null };
    render(<UserPromptSection />);
    expect((editor() as HTMLTextAreaElement).disabled).toBe(true);
    expect(saveButton().disabled).toBe(true); expect(screen.getByRole('status').textContent).toBe('hostSettings.loadFailed');
  });
});
