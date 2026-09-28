import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CommittedAuthIdentity } from '../authManager.js';

// 只执行真实窄出口的函数体；不加载 authManager 的运行时依赖，也不为测试添加身份写入口。
const source = readFileSync(resolve(process.cwd(), 'src/main/authManager.ts'), 'utf8');
const parsed = ts.createSourceFile('authManager.ts', source, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'peekCommittedAuthIdentity');
if (!declaration?.body) throw new Error('Missing committed auth identity reader');
const functionSource = declaration.getText(parsed).replace(/^export\s+/, '');
const compiled = ts.transpileModule(functionSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText;

function inspect(user: unknown, token: unknown): CommittedAuthIdentity | null {
  return vm.runInNewContext(`${compiled}\npeekCommittedAuthIdentity()`, {
    currentUser: user, accessToken: token,
  }) as CommittedAuthIdentity | null;
}

describe('peekCommittedAuthIdentity', () => {
  it('is a pure projection without function calls, construction, mutation, or asynchronous work', () => {
    const forbidden: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node)
        || ts.isDeleteExpression(node) || ts.isPostfixUnaryExpression(node)
        || (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))
        || (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
          && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment)) forbidden.push(node);
      ts.forEachChild(node, visit);
    };
    visit(declaration.body!);
    expect(forbidden.map((node) => node.getText(parsed))).toEqual([]);
    expect(declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
  });

  it.each(['personal', 'org'] as const)('projects only %s identity and token presence', (membershipKind) => {
    const result = inspect({ id: 'membership-test', membershipKind, email: 'private@example.invalid', displayName: 'Private' }, 'test-only-memory-token');
    expect(result).toEqual({ userId: 'membership-test', membershipKind, isAuthenticated: true });
    expect(Object.keys(result!).sort()).toEqual(['isAuthenticated', 'membershipKind', 'userId']);
  });

  it.each([null, undefined, '', 0, false, {}])('does not authenticate with absent or non-string token %j', (token) => {
    expect(inspect({ id: 'membership-test', membershipKind: 'org' }, token))
      .toEqual({ userId: 'membership-test', membershipKind: 'org', isAuthenticated: false });
  });

  it.each([null, undefined, {}, { id: 'member' }, { id: 'member', membershipKind: 'unknown' },
    { id: 'member', membershipKind: null }, { id: '', membershipKind: 'org' }, { id: 3, membershipKind: 'org' }])
  ('fails closed for unready or unknown identity %j', (user) => {
    expect(inspect(user, 'test-only-memory-token')).toBeNull();
  });

  it('returns a detached identity object and does not mutate the current user', () => {
    const user = Object.freeze({ id: 'membership-test', membershipKind: 'org' });
    const first = inspect(user, 'test-only-memory-token')!;
    first.userId = 'changed';
    first.membershipKind = 'personal';
    expect(inspect(user, 'test-only-memory-token'))
      .toEqual({ userId: 'membership-test', membershipKind: 'org', isAuthenticated: true });
    expect(user).toEqual({ id: 'membership-test', membershipKind: 'org' });
  });
});
