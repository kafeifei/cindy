import { z } from 'zod';

/** Preview-only plugin launch model. No live Host/CIS resource is registered for it.
 * Existing credential submissions use the signed plugin authorization channel. */
export const cloudPluginCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('list'),
      offset: z.number().int().min(0).max(100000).default(0),
    })
    .strict(),
  z
    .object({
      operation: z.literal('start'),
      operationId: z.string().uuid(),
      pluginId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({ operation: z.literal('open-settings'), pluginId: z.string().min(1).max(256) })
    .strict(),
  z.object({ operation: z.literal('status'), operationId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal('cancel'), operationId: z.string().uuid() }).strict(),
]);
export const cloudPluginResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('settings'), pluginId: z.string().min(1).max(256) }).strict(),
  z
    .object({
      kind: z.literal('plugins'),
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().positive().optional(),
      items: z
        .array(
          z
            .object({
              id: z.string().min(1).max(256),
              name: z.string().max(512),
              ready: z.boolean(),
              authorization: z.enum(['setup', 'github-cli', 'settings']).optional(),
              settingsAvailable: z.boolean().optional(),
            })
            .strict(),
        )
        .max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setup'),
      operationId: z.string().uuid(),
      phase: z.enum(['starting', 'waiting', 'succeeded', 'failed', 'cancelled', 'unknown']),
      snapshot: z.unknown().optional(),
    })
    .strict(),
]);
export type CloudPluginCommand = z.input<typeof cloudPluginCommandSchema>;
export type CloudPluginResult = z.infer<typeof cloudPluginResultSchema>;
