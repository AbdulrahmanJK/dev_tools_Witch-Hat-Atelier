import fs from 'node:fs';
import { parse } from '@babel/parser';

export function parseFileToAst(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: [
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
      ],
      tokens: false,
      ranges: false,
    });
    return { ast, code, error: null };
  } catch (error) {
    return { ast: null, code: '', error: error.message };
  }
}
