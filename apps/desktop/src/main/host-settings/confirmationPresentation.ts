import { additionalSettingsPresentation } from '../../shared/settingsEditablePresentation.js';
import { isAdditionalSettingsDomain, additionalSettingsMetadata, settingsValuesEqual } from '../../shared/settingsEditableCatalog.js';
import type { SettingsConfirmationPreview } from '@cindy/maker-shared/interaction';
import { HostSettingsError } from './operations.js';

type Translate = (key: string, values?: Record<string, string | number>) => string;
const fields: Record<string, readonly string[]> = {
  newTaskDefaults: ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking', 'worktree', 'planMode'],
  personalization: ['userPrompt'],
  databaseWarning: ['thresholdGiB', 'disabled'],
  appearance: ['uiFamily', 'codeFamily', 'uiSize', 'codeSize', 'windowZoom'],
  ...Object.fromEntries(Object.entries(additionalSettingsPresentation).map(([domain, value]) => [domain, Object.keys(value.fields)])),
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The Host prepares display text from its captured change, never from model-written summaries. */
export function buildSettingsConfirmationPreview(input: Record<string, unknown>, t: Translate): SettingsConfirmationPreview {
  const domain = typeof input.domain === 'string' ? input.domain : '';
  if (!Object.hasOwn(fields, domain)) throw new HostSettingsError('INVALID_PARAMS');
  const extra = isAdditionalSettingsDomain(domain) ? additionalSettingsPresentation[domain] : undefined;
  const label = (field: string) => extra ? extra.fields[field]!.labelKey.startsWith('@') ? extra.fields[field]!.labelKey.slice(1) : t(extra.fields[field]!.labelKey) : t(`hostSettings.card.fields.${field}`);
  const read = input.action === 'read_user_prompt';
  if (read && domain !== 'personalization') throw new HostSettingsError('INVALID_PARAMS');
  const text = (key: string, values?: Record<string, string | number>) => t(`hostSettings.card.${key}`, values);
  const valueText = (field: string, value: unknown): string => {
    const option = extra?.fields[field]?.options?.find(([choice]) => choice === value);
    if (option) return option[1].startsWith('@') ? option[1].slice(1) : t(option[1]);
    if (value === null) return text('automatic');
    if (extra?.fields[field]?.select) {
      if (Array.isArray(value)) return value.length ? value.map(item => valueText(field, item)).join(' → ') : text(field === 'targetModels' ? 'empty' : 'automatic');
      if (domain === 'shortcuts') {
        const row = record(value);
        const labelKey = extra.fields[field]!.labels?.[String(row.id)];
        if (!labelKey) throw new HostSettingsError('INVALID_PARAMS');
        const combo = row.code === null ? t('hostSettings.editor.disabled') : [...['ctrl', 'alt', 'shift', 'meta'].filter(key => row[key]).map(key => key === 'meta' ? 'Super / ⌘' : key === 'ctrl' ? 'Ctrl' : key === 'alt' ? 'Alt' : 'Shift'), row.code].join(' + ');
        return `${t(labelKey)}: ${combo}`;
      }
      const choices = record(input.choices)[field];
      const choice = Array.isArray(choices) ? choices.find(candidate => {
        const item = record(candidate);
        if (settingsValuesEqual(item.value, value)) return true;
        return (domain === 'botModelChain' || extra.fields[field]?.select === 'route' || extra.fields[field]?.select === 'table')
          && (extra.fields[field]?.identity ?? (domain === 'botModelChain' ? ['harness', 'providerId', 'model'] : extra.fields[field]?.select === 'table' ? ['harness', 'providerId', 'modelId'] : ['providerId', 'modelId'])).every(key => record(item.value)[key] === record(value)[key]);
      }) : null;
      let name = typeof record(choice).label === 'string' ? String(record(choice).label)
        : typeof value === 'string' ? value : String(record(value).ghostId ?? record(value).workspaceId ?? record(value).modelId ?? record(value).model ?? record(value).providerId ?? '');
      if (!name) throw new HostSettingsError('INVALID_PARAMS');
      if (domain === 'botModelChain' || extra.fields[field]?.select === 'route') {
        const route = record(value);
        name += ` · ${route.effort ? t(`effortLevels.${route.effort}`) : text('automatic')}`;
        if (route.fastMode) name += ` · ${text('fields.fast')}`;
      }
      if (extra.fields[field]?.columns) {
        const row = record(value);
        for (const [key, column] of Object.entries(extra.fields[field]!.columns!)) {
          const available = record(input.choices)[column.choiceSource === 'row' ? `${field}:${row[extra.fields[field]?.identity?.[0] ?? 'ghostId']}` : column.choiceSource ?? ''];
          const selected = Array.isArray(available) ? available.find(item => column.merge
            ? (column.mergeKeys ?? ['harness', 'providerId', 'modelId']).every(part => record(record(item).value)[part] === row[part])
            : settingsValuesEqual(record(item).value, row[key])) : undefined;
          const option = column.options?.find(([value]) => settingsValuesEqual(value, row[key]));
          const display = typeof record(selected).label === 'string' ? String(record(selected).label)
            : option ? option[1].startsWith('@') ? option[1].slice(1) : t(option[1])
            : column.merge ? [row.harness, row.providerId, row.modelId].filter(Boolean).join(' / ') || text('automatic')
            : row[key] === null ? text('automatic') : typeof row[key] === 'boolean' ? text(row[key] ? 'on' : 'off')
            : key === 'effort' ? t(`effortLevels.${row[key]}`) : String(row[key]);
          name += ` · ${t(column.labelKey)}: ${display}`;
        }
      }
      return name;
    }
    if (typeof value === 'boolean') return text((field === 'disabled' ? !value : value) ? 'on' : 'off');
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (field === 'thresholdGiB') return `${value} GiB`;
      if (field === 'windowZoom') return `${Math.round(value * 100)}%`;
      return String(value);
    }
    if (typeof value !== 'string') throw new HostSettingsError('INVALID_PARAMS');
    if (!value) return text('empty');
    if (field === 'effort') {
      if (!['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)) {
        throw new HostSettingsError('INVALID_PARAMS');
      }
      return t(`effortLevels.${value}`);
    }
    if (field === 'harness') {
      const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'Pi' };
      return names[value] ?? value;
    }
    return value;
  };
  const set = record(input.set);
  const clear = Array.isArray(input.clear) ? input.clear : [];
  const before = record(input.before);
  const defaults = record(input.defaults);
  const changes: SettingsConfirmationPreview['changes'] = [];
  for (const field of [...Object.keys(set), ...clear]) {
    if (typeof field !== 'string' || !fields[domain]!.includes(field)
      || changes.some(change => change.label === label(field))) throw new HostSettingsError('INVALID_PARAMS');
    const reset = clear.includes(field);
    const value = reset ? text('followDefault', { value: valueText(field, domain === 'personalization' ? '' : defaults[field]) }) : valueText(field, set[field]);
    // Prompt content is not disclosed merely to describe the previous choice.
    const previous = domain === 'personalization' || domain === 'telegramPersona' && field === 'soul'
      ? text(domain === 'personalization' ? before.isCustomized === true ? 'customized' : 'notSet' : before.soul ? 'customized' : 'notSet')
      : Object.hasOwn(before, field) ? valueText(field, before[field]) : undefined;
    changes.push({ label: label(field), ...(previous !== undefined ? { previous } : {}), value });
  }
  if (!read && changes.length === 0) throw new HostSettingsError('INVALID_PARAMS');
  return {
    version: 1,
    title: text(read ? 'readTitle' : 'title'),
    description: domain === 'workspaceTools' && typeof input.workspaceLabel === 'string'
      ? `${t('hostSettings.editor.workingDirectory')}: ${input.workspaceLabel}. ${text('effects.newTaskDefaults')}`
      : isAdditionalSettingsDomain(domain)
      ? additionalSettingsMetadata[domain].applies === 'next_connection' ? t('hostSettings.editor.nextConnection')
        : text(`effects.${additionalSettingsMetadata[domain].applies === 'host_desktop_only' ? 'appearance' : additionalSettingsMetadata[domain].applies === 'next_agent_start' ? 'personalization' : additionalSettingsMetadata[domain].applies === 'next_task' ? 'newTaskDefaults' : 'databaseWarning'}`)
      : text(read ? 'readDescription' : `effects.${domain}`),
    confirmLabel: text(read ? 'read' : 'save'),
    cancelLabel: text('cancel'),
    changes,
  };
}
