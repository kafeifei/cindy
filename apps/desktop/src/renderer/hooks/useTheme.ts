import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { createElement, type ReactNode } from 'react';

import {
  resolveFamilyVariant,
  tryGetFamily,
} from '../themes/families';
import { onLocalThemesChange } from '../themes/local-themes';
import { themeService } from '../themes/theme-service';
import type { ThemeType } from '../themes/types';
import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../state/hostDesktopPreferences';

export type Theme = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  familyId: string;
  setFamily: (familyId: string) => void;
  /**
   * 当前家族在请求 type 下没变体, 已 fallback 到另一个 type 时, 这里
   * 返回 "请求的 type" (供 UI 显示 "无浅色 / 无深色" 提示)。否则 null。
   */
  fallbackFromType: ThemeType | null;
}

const LOGIN_FIRST_LAUNCH_KEY = 'login.firstLaunchLightShown';
const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  // jsdom 等测试环境可能没有 matchMedia,兜底按 light 解析(不影响真实运行时)
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(PREFERS_DARK_QUERY).matches;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** 首次同步读取 Host；仅在迁移未完成时保留旧偏好作为启动缓存。 */
export function getStoredTheme(): Theme { return getDesktopPreference('theme'); }
export function getStoredFamilyId(): string { return getDesktopPreference('themeFamilyId'); }

function resolveActiveTheme(mode: Theme) {
  const isDark = resolveIsDark(mode);
  return resolveFamilyVariant(getStoredFamilyId(), isDark ? 'dark' : 'light');
}

function resolveSessionActiveTheme(mode: Theme) {
  return resolveActiveTheme(firstLaunchLightSession === true ? 'light' : mode);
}

function resolveSessionIsDark(mode: Theme): boolean {
  return resolveSessionActiveTheme(mode).theme.type === 'dark';
}

function systemModeFollowsSystem(familyId: string): boolean {
  const family = tryGetFamily(familyId);
  return Boolean(family?.light && family?.dark);
}

// 切主题时临时禁掉所有 transition,避免带 transition-colors 的元素(顶栏图标、
// 设置侧边活动项、Logout 按钮等)慢 150ms 淡到新色,看起来和瞬间换色的其他部分不同步。
// hover/active 等交互态的 transition 不受影响 —— 注入只在切换那一瞬生效,下一帧就移除。
function disableTransitionsTemporarily(): void {
  const style = document.createElement('style');
  style.appendChild(document.createTextNode('*,*::before,*::after{transition:none !important}'));
  document.head.appendChild(style);
  // 强制 reflow,确保 .dark 类切换 + 新计算样式已落盘,再移除禁用样式。
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  window.getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => {
    style.remove();
  });
}

export function applyThemeClass(theme: Theme, force = false): void {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  // 首启亮色门激活期间(pre-login 会话)一律按亮色解析——ThemeProvider 挂载
  // 重放与系统色变化都不会把登录界面翻回暗色;门由登录页卸载时结束。
  const { theme: nextTheme } = resolveSessionActiveTheme(theme);
  const nextDark = nextTheme.type === 'dark';

  if (!force && nextDark === wasDark && root.dataset.theme === nextTheme.id) {
    return;
  }

  if (nextDark !== wasDark) {
    disableTransitionsTemporarily();
  }

  themeService.applyTheme(nextTheme);
}

/** index.tsx bootstrap 用 —— 不依赖 React context。首启亮色门在此生效:
 * 真首启(见 initLoginFirstLaunchLightGate)整个 pre-login 会话按亮色解析,
 * 品牌舞台首帧即亮色,无暗→亮闪变。 */
export function getInitialThemeVariant() {
  return resolveActiveTheme(initLoginFirstLaunchLightGate() ? 'light' : getStoredTheme());
}

/**
 * 登录首启亮色门(主题跟随产品逻辑,DESIGN.md §16.5):用户**首次**打开 Cindy
 * → 亮色登录界面(默认);**第二次起** → 跟随用户上一次使用的主题。
 *
 * 会话级判定,首次调用即定型(bootstrap 在任何渲染前调用,品牌舞台首帧就是
 * 亮色——不存在暗→亮闪变):
 *  - 已有标记 → false(第二次起,跟随正常主题解析);
 *  - 无标记且 renderer localStorage 为空且主进程无存量会话(sync 线索,见
 *    decideLoginFirstLaunchLight)→ **真首启**,true 并落盘标记;
 *  - 无标记但已有其它本地状态、或主进程持有存量会话(持久化 refresh token /
 *    local 模式——renderer 存储被清空的已登录用户,认证恢复后直进受保护路由)
 *    → false(绝不能把他们的界面强制成亮色,哪怕一帧),同样落盘标记防复判。
 * 门激活期间 applyThemeClass 全部按亮色解析(含系统色变化重放);登录页卸载
 * 时经 endLoginFirstLaunchLightGate 结束并恢复存储主题。不改用户 theme 偏好。
 */
let firstLaunchLightSession: boolean | null = null;

/**
 * 首启判定核心(纯函数,供单测):三个条件缺一不可——无「已展示」标记、
 * renderer 本地存储全空、主进程无存量会话。第三条堵住 localStorage 被清空
 * 但主进程仍持有会话的误判:那种启动会跳过 LoginPage 直进应用,若激活门,
 * 暗色用户会先看到亮色首帧(修复前甚至因清理路径不触发而整个会话锁亮色)。
 */
export function decideLoginFirstLaunchLight(input: {
  hasShownMarker: boolean;
  rendererStorageEmpty: boolean;
  mainHasPersistedSession: boolean;
}): boolean {
  if (input.hasShownMarker) return false;
  return input.rendererStorageEmpty && !input.mainHasPersistedSession;
}

/** 主进程存量会话线索(preload sendSync 桥)。API 缺失 / 抛错按「无会话」兜底,
 * 行为退化为旧的 localStorage 判定。 */
function mainProcessHasPersistedSession(): boolean {
  try {
    return window.electronAPI?.authHasPersistedSessionHintSync?.() === true;
  } catch {
    return false;
  }
}

/** 判定并激活首启门 —— **只由 bootstrap(getInitialThemeVariant)调用**,任何
 * 渲染前执行一次即定型;组件侧一律走无副作用的 loginFirstLaunchLightActive()
 * 读取(测试挂载组件不会误触发判定/写标记)。 */
function initLoginFirstLaunchLightGate(): boolean {
  if (firstLaunchLightSession !== null) return firstLaunchLightSession;
  try {
    const hasShownMarker = localStorage.getItem(LOGIN_FIRST_LAUNCH_KEY) !== null;
    firstLaunchLightSession = decideLoginFirstLaunchLight({
      hasShownMarker,
      rendererStorageEmpty: localStorage.length === 0,
      mainHasPersistedSession: mainProcessHasPersistedSession(),
    });
    if (!hasShownMarker) {
      localStorage.setItem(LOGIN_FIRST_LAUNCH_KEY, String(Date.now()));
    }
  } catch {
    // localStorage 不可用时不强制亮色,按正常主题解析兜底
    firstLaunchLightSession = false;
  }
  return firstLaunchLightSession;
}

/** 首启亮色门当前是否激活(无副作用读取,供登录页卸载钩子判断)。 */
export function loginFirstLaunchLightActive(): boolean {
  return firstLaunchLightSession === true;
}

/** 结束首启亮色门(登录页卸载 = 登录完成/离开时调用),恢复存储主题解析。 */
export function endLoginFirstLaunchLightGate(): void {
  if (firstLaunchLightSession !== true) return;
  firstLaunchLightSession = false;
  const mode = getStoredTheme();
  const familyId = getStoredFamilyId();
  applyThemeClass(mode, true);
  // 首启门结束不会改变 ThemeProvider 的 React state，因此对应 effect 不会自动重跑。
  // 在这里用恢复后的实际主题立即同步 backing，同时保留用户原始模式供下次冷启动解析。
  window.electronAPI?.theme?.applyVibrancy?.(
    familyId,
    resolveSessionIsDark(mode),
    mode,
    systemModeFollowsSystem(familyId),
  );
}

export function __resetLoginFirstLaunchLightGateForTest(): void {
  firstLaunchLightSession = null;
}

export function ThemeProvider({
  children,
  syncWindowVibrancy = true,
}: {
  children: ReactNode;
  syncWindowVibrancy?: boolean;
}) {
  const theme = useDesktopPreference('theme');
  const familyId = useDesktopPreference('themeFamilyId');
  // 跟踪系统色偏好, 让 fallbackFromType 在 OS theme 变化时也能正确刷新。
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia(PREFERS_DARK_QUERY).matches,
  );
  // 本地主题内容变化时刷新家族缓存；读取最新 Host 确认值，避免闭包保留旧偏好。
  const [localThemeRev, bumpLocalThemeRev] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onLocalThemesChange(() => {
    // 保留暂不可用的本地家族选择；加载或删除主题文件不得改写已保存的 ID。
    bumpLocalThemeRev();
    applyThemeClass(getStoredTheme(), true);
  }), []);

  const setTheme = useCallback((next: Theme) => {
    void setDesktopPreference('theme', next);
  }, []);
  const setFamily = useCallback((next: string) => {
    if (tryGetFamily(next)) void setDesktopPreference('themeFamilyId', next).then(saved => {
      // 同 ID 的本地主题内容可能已刷新；只有 Host 成功回执后才重新应用。
      if (saved) applyThemeClass(getStoredTheme(), true);
    });
  }, []);

  // 初次挂载或 Host 确认的 mode/family 变化统一应用主题；跨窗口回执也走这里。
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme, familyId]);

  useEffect(() => {
    window.electronAPI?.setUpdateRelaunchTheme?.(
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );
  }, [familyId, systemPrefersDark, theme]);

  // OS 色偏好变化: 在 system 模式下重新 apply, 同时同步 systemPrefersDark
  // 让 fallbackFromType 刷新。非 system 模式只同步 state, 不动 DOM。
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(PREFERS_DARK_QUERY);
    const handleChange = () => {
      setSystemPrefersDark(mediaQuery.matches);
      if (theme === 'system') {
        applyThemeClass('system');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme]);

  // E4D 毛玻璃(R1 audit,用户裁决透壁纸 2026-07-17):family/theme 变化或 mount 时
  // 通知 main 开关 macOS vibrancy(仅 CINDY family 启用,其他恢复不透明)。覆盖
  // 本窗口提交、Host 跨窗口回执、挂载三个场景(任一变化都重应用)。
  useEffect(() => {
    if (!syncWindowVibrancy) return;
    window.electronAPI?.theme?.applyVibrancy?.(
      familyId,
      resolveSessionIsDark(theme),
      theme,
      systemModeFollowsSystem(familyId),
    );
  }, [familyId, localThemeRev, syncWindowVibrancy, theme, systemPrefersDark]);

  const fallbackFromType = useMemo<ThemeType | null>(() => {
    void localThemeRev;
    const family = tryGetFamily(familyId);
    if (!family) return null;
    const isDarkRequested = theme === 'dark' || (theme === 'system' && systemPrefersDark);
    const requestedType: ThemeType = isDarkRequested ? 'dark' : 'light';
    return family[requestedType] === null ? requestedType : null;
  }, [familyId, theme, systemPrefersDark, localThemeRev]);

  return createElement(
    ThemeContext.Provider,
    {
      value: {
        theme,
        setTheme,
        familyId,
        setFamily,
        fallbackFromType,
      },
    },
    children,
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
