import { useEffect } from 'react';
import { MODEL_FAVORITE_TEXT_MAX_LENGTH } from '@cindy/device-link';
import {
  getDataOwnerGeneration,
  isDataOwnerPushStampCurrent,
} from '@/contexts/dataOwnerGeneration';
import { accessHostModelFavorites, subscribeModelFavorites } from './modelFavorites';

export function useModelFavoritesHost(): void {
  useEffect(() => {
    const api = window.electronAPI.modelFavoritesHost;
    if (!api) return;
    const off = api.onRequest(async (request) => {
      try {
        const assertCurrent = () => {
        if (Date.now() > request.expiresAt || !isDataOwnerPushStampCurrent(request.ownerStamp))
          throw new Error('Expired favorite request');
        };
        assertCurrent();
        const items = await accessHostModelFavorites(request.ownerStamp.dataOwnerId, request.mutation, assertCurrent);
        assertCurrent();
        api.reply({ requestId: request.requestId, items: items.filter((item) => item.providerId.length <= MODEL_FAVORITE_TEXT_MAX_LENGTH) });
      } catch {
        api.reply({ requestId: request.requestId, failed: true });
      }
    });
    api.ready();
    const unsubscribe = subscribeModelFavorites(() => {
      const owner = getDataOwnerGeneration();
      api.changed({ dataOwnerId: owner.dataOwnerId, ownerGeneration: owner.generation });
    });
    return () => {
      off();
      unsubscribe();
    };
  }, []);
}
