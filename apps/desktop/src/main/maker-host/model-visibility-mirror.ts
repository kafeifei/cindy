/** IM、供应商列表和 bot 模型消费的兼容门面，保留名称避免改动消费者。
 * 不再有 Renderer 权威镜像：每次读取都来自唯一 Host 偏好文件，无 Renderer 也可读取。
 */
import { createModelVisibilityMirror } from '../../shared/modelVisibilityMirror.js';
import {
  inspectModelPresentationPreferences,
  onModelPresentationPreferencesChanged,
} from '../host-settings/model-presentation-preferences.js';

const mirror = createModelVisibilityMirror({
  inspectModelPresentationPreferences,
  onModelPresentationPreferencesChanged,
});

export const {
  waitForModelVisibilityMirror,
  setModelVisibilityMirror,
  syncModelVisibilityMirror,
  syncModelVisibilityMirrorForOwner,
  getModelVisibilityOverride,
  getModelVisibilityMirrorSnapshot,
  clearModelVisibilityMirror,
  __resetModelVisibilityMirrorForTest,
} = mirror;
