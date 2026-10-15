import { describe, expect, it } from 'vitest';
import { SETTINGS_READ_FIELD_IDS, SETTINGS_READ_COLLECTION_IDS, SETTINGS_READ_EXTERNAL_CATALOG } from '../settingsReadCatalog.js';
import { additionalSettingsSchemas } from '../settingsEditableCatalog.js';
import { cloudSettingsFieldCoverage, CLOUD_SETTINGS_COLLECTION_COVERAGE, CLOUD_SETTINGS_EXTERNAL_COVERAGE, type CloudSettingsCoverage } from '../settingsCloudCoverage.js';
import { HOST_SETTINGS_CATALOG } from '../hostSettings.js';
describe('complete client directory to cloud settings coverage', () => {
  it('does not invent independent writes for the native Git mode or its derived boolean', () => {
    expect(cloudSettingsFieldCoverage('gitSafety.mode')?.kind).toBe('dedicated');
    expect(cloudSettingsFieldCoverage('gitSafety.autoInitProjectGit')?.kind).toBe('derived');
    expect(cloudSettingsFieldCoverage('gitSafety.autoSnapshotEnabled')).toEqual({ kind: 'editable', domain: 'gitSafety', field: 'autoSnapshotEnabled' });
    expect(cloudSettingsFieldCoverage('voice.composerLongPressEnabled')?.kind).toBe('notApplicable');
  });
  it('accounts for every fixed field, collection and dedicated entry without inferring writability', () => {
    const extra = Object.fromEntries(Object.entries(additionalSettingsSchemas).map(([id,schema])=>[id,Object.keys(schema.shape)]));
    const native: Record<string,string[]> = {newTaskDefaults:['harness','providerId','modelId','effort','fast','thinking','worktree','planMode'],personalization:['userPrompt'],databaseWarning:['thresholdGiB','disabled'],appearance:['uiFamily','codeFamily','uiSize','codeSize','windowZoom']};
    const check = (id:string, entry:CloudSettingsCoverage | undefined) => {
      expect(entry,id).toBeDefined(); if (!entry) return;
      if(entry.kind==='editable') {
        expect((extra[entry.domain]??native[entry.domain]),id).toContain(entry.field);
        expect(HOST_SETTINGS_CATALOG.some(item=>item.domain===entry.domain),id).toBe(true);
      } else expect(entry.reason.length,id).toBeGreaterThan(10);
    };
    for(const id of SETTINGS_READ_FIELD_IDS) check(id,cloudSettingsFieldCoverage(id));
    for(const id of SETTINGS_READ_COLLECTION_IDS) check(id,CLOUD_SETTINGS_COLLECTION_COVERAGE[id]);
    for(const entry of SETTINGS_READ_EXTERNAL_CATALOG) check(entry.id,CLOUD_SETTINGS_EXTERNAL_COVERAGE[entry.id]);
  });
});
