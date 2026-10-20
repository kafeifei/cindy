import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DeviceLinkError } from '@cindy/device-link';
import { expect, it, vi } from 'vitest';

// Execute the provider's actual recovery callback without booting React Native.
const source = ts.createSourceFile('provider.tsx', readFileSync(new URL('../device-link/DeviceLinkContext.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'recoverLinkBeforeSend' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpileModule('const recover = ' + callback!.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
it.each(['ready', 'recovery', 'closed', 'account-changed', 'cancelled', 'superseded'])('validates the mobile recovery owner: %s', async mode => {
  let current = true, closed = false;
  const client = { needsLinkRecovery: () => mode !== 'ready', isOutboundExplicitlyClosed: () => closed };
  const clientRef = { current: client as unknown };
  const openLinkInFlightRef = { current: new Map() };
  const sendOpenLinkOnce = vi.fn((_c, id) => {
    const tracked = { request: Promise.resolve().then(() => {
      if (mode === 'closed') closed = true;
      if (mode === 'account-changed') clientRef.current = {};
      if (mode === 'cancelled') current = false;
      if (mode === 'superseded') openLinkInFlightRef.current.delete(id);
    }) };
    openLinkInFlightRef.current.set(id, tracked);
    return tracked;
  });
  const deps = { DeviceLinkError, sendOpenLinkOnce, clientRef, openLinkInFlightRef };
  const recover = new Function(...Object.keys(deps), code + '; return recover;')(...Object.values(deps));
  const send = vi.fn();
  const pending = recover(client, 'host', () => { if (!current) throw new Error('cancelled'); }).then(send);
  if (['ready', 'recovery'].includes(mode)) { await pending; expect(send).toHaveBeenCalledOnce(); }
  else { await expect(pending).rejects.toThrow(); expect(send).not.toHaveBeenCalled(); }
  expect(sendOpenLinkOnce).toHaveBeenCalledTimes(mode === 'ready' ? 0 : 1);
  if (mode !== 'ready') expect(sendOpenLinkOnce).toHaveBeenCalledWith(client, 'host', false, true);
});
