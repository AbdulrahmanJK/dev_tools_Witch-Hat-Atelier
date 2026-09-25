import fs from 'node:fs';
import { parse, type ParserPlugin } from '@babel/parser';

export interface ParseResult {
  ast: any | null;
  code: string;
  error: string | null;
  mode: 'complete' | 'partial' | 'unreadable';
}

export function parseFileToAst(filePath: string): ParseResult {
  let code = '';
  try {
    code = fs.readFileSync(filePath, 'utf8');
    const isTypeScript = /\.[cm]?tsx?$/.test(filePath);
    const isJsx = /\.[cm]?[jt]sx$/.test(filePath);
    const plugins: ParserPlugin[] = [
      ...(isJsx ? ['jsx' as ParserPlugin] : []),
      ...(isTypeScript ? ['typescript' as ParserPlugin] : []),
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'exportDefaultFrom',
      'dynamicImport',
      'nullishCoalescingOperator',
      'optionalChaining',
      'topLevelAwait',
      'objectRestSpread',
      ['decorators', { decoratorsBeforeExport: true }],
    ];

    const options = { sourceType: 'unambiguous' as const, plugins, tokens: false, ranges: false,
      errorRecovery: true, allowUndeclaredExports: true };
    const ast = parse(code, options);
    const warnings = ast.errors?.map((item: Error) => item.message) || [];
    return { ast, code, error: warnings.length ? warnings.slice(0, 3).join('; ') : null, mode: warnings.length ? 'partial' : 'complete' };
  } catch (error: any) {
    return { ast: null, code, error: error?.message || 'Unknown parsing failure', mode: 'unreadable' };
  }
}
