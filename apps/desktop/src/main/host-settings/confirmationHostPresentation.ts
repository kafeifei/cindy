import { t } from '../i18n.js';
import { buildSettingsConfirmationPreview } from './confirmationPresentation.js';

/** Main's translator supplies the locale text; it does not interpolate values. */
export function buildHostSettingsConfirmationPreview(input: Record<string, unknown>) {
  return buildSettingsConfirmationPreview(input, (key, values) => t(key).replace(
    /\{\{(\w+)\}\}/g,
    (placeholder, name: string) => values && Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  ));
}
