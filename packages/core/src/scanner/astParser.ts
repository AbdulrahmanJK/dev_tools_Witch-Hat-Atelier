import fs from 'node:fs';
import { parse, type ParserPlugin } from '@babel/parser';

export interface ParseResult {
  ast: any | null;
  code: string;
  error: string | null;
}

export function parseFileToAst(filePath: string): ParseResult {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const plugins: ParserPlugin[] = [
      'jsx',
      'typescript',
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

    const ast = parse(code, {
      sourceType: 'module',
      plugins,
      tokens: false,
      ranges: false,
    });
    return { ast, code, error: null };
  } catch (error: any) {
    return { ast: null, code: '', error: error?.message || 'Unknown parsing failure' };
  }
}
