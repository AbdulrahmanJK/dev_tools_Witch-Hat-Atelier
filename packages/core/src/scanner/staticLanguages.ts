/** Source-level symbols for languages without a runtime adapter. */
export type StaticLanguage = 'go' | 'java' | 'kotlin' | 'csharp';
export type StaticSymbolKind = 'class' | 'interface' | 'struct' | 'record' | 'enum' | 'object' | 'function' | 'method' | 'property' | 'field' | 'module';

export interface StaticSymbol {
  name: string;
  kind: StaticSymbolKind;
  line: number;
  endLine: number;
  signature?: string;
  container?: string;
  modifiers?: string[];
  constructs?: { loops: number; branches: number; awaits: number };
}

export interface StaticFileAnalysis {
  language: StaticLanguage;
  namespace: string | null;
  imports: string[];
  symbols: StaticSymbol[];
}

const extensions: Record<string, StaticLanguage> = { '.go': 'go', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.cs': 'csharp' };
export function staticLanguageForExtension(extension: string): StaticLanguage | null { return extensions[extension.toLowerCase()] || null; }

function maskNonCode(source: string): string {
  const output = source.split('');
  let index = 0;
  while (index < source.length) {
    const ch = source[index]!;
    const next = source[index + 1];
    if (ch === '/' && next === '/') {
      let end = index + 2;
      while (end < source.length && source[end] !== '\n') end++;
      for (let i = index; i < end; i++) output[i] = ' ';
      index = end;
    } else if (ch === '/' && next === '*') {
      let end = source.indexOf('*/', index + 2);
      end = end < 0 ? source.length : end + 2;
      for (let i = index; i < end; i++) if (source[i] !== '\n') output[i] = ' ';
      index = end;
    } else if (ch === '"' || ch === '\'' || ch === '`') {
      const triple = ch === '"' && source.slice(index, index + 3) === '"""';
      const verbatim = ch === '"' && index > 0 && source[index - 1] === '@';
      const delimiter = triple ? '"""' : ch;
      let end = index + delimiter.length;
      while (end < source.length) {
        if (!verbatim && !triple && source[end] === '\\') { end += 2; continue; }
        if (source.slice(end, end + delimiter.length) === delimiter) {
          if (verbatim && source[end + 1] === '"') { end += 2; continue; }
          end += delimiter.length; break;
        }
        end++;
      }
      for (let i = index; i < Math.min(end, source.length); i++) if (source[i] !== '\n') output[i] = ' ';
      index = end;
    } else index++;
  }
  return output.join('');
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0, high = starts.length;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid]! <= offset) low = mid; else high = mid; }
  return low + 1;
}

function matching(code: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i;
  }
  return -1;
}

function normalizeSignature(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 220); }
function countConstructs(code: string): { loops: number; branches: number; awaits: number } {
  return {
    loops: (code.match(/\b(?:for|foreach|while)\b/g) || []).length,
    branches: (code.match(/\b(?:if|switch|when)\b/g) || []).length,
    awaits: (code.match(/\bawait\b/g) || []).length,
  };
}

export function scanStaticSource(source: string, language: StaticLanguage): StaticFileAnalysis {
  const code = maskNonCode(source);
  const starts = lineStarts(source);
  const depth = new Uint16Array(code.length + 1);
  let currentDepth = 0;
  for (let i = 0; i < code.length; i++) {
    depth[i] = currentDepth;
    if (code[i] === '{') currentDepth++;
    else if (code[i] === '}') currentDepth = Math.max(0, currentDepth - 1);
  }
  depth[code.length] = currentDepth;

  const namespace = language === 'go' ? /^\s*package\s+([\w]+)/m.exec(code)?.[1] || null
    : language === 'java' || language === 'kotlin' ? /^\s*package\s+([\w.]+)/m.exec(code)?.[1] || null
      : /\bnamespace\s+([\w.]+)/.exec(code)?.[1] || null;
  const imports: string[] = [];
  const importPattern = language === 'go' ? /^\s*(?:import\s+)?(?:[\w.]+\s+)?["`]([^"`]+)["`]/gm
    : language === 'csharp' ? /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm
      : /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;?/gm;
  for (const match of (language === 'go' ? source : code).matchAll(importPattern)) if (match[1]) imports.push(match[1]);

  const symbols: StaticSymbol[] = [];
  const ranges: Array<{ name: string; start: number; end: number; depth: number; kind: StaticSymbolKind }> = [];
  const addType = (kind: StaticSymbolKind, name: string, start: number, after: number) => {
    const brace = code.indexOf('{', after);
    const semicolon = code.indexOf(';', after);
    const nextKotlinDeclaration = language === 'kotlin' && brace >= 0 && /\n\s*(?:fun|class|interface|object|val|var)\b/.test(code.slice(after, brace));
    const hasBody = brace >= 0 && brace - after < 600 && (semicolon < 0 || brace < semicolon) && !nextKotlinDeclaration;
    const end = hasBody ? matching(code, brace, '{', '}') : Math.max(start, semicolon >= 0 && semicolon - after < 600 ? semicolon : after);
    const parent = ranges.filter((range) => range.start < start && start < range.end).at(-1);
    const fullName = parent ? `${parent.name}.${name}` : name;
    symbols.push({ name, kind, line: lineAt(starts, start), endLine: lineAt(starts, end < 0 ? start : end), container: parent?.name,
      signature: normalizeSignature(source.slice(start, Math.min(hasBody ? brace : end + 1, start + 220))),
      constructs: countConstructs(code.slice(start, Math.max(start, end + 1))) });
    if (language === 'kotlin' || kind === 'record') {
      const parameterOpen = code.indexOf('(', after);
      const parameterClose = parameterOpen >= 0 ? matching(code, parameterOpen, '(', ')') : -1;
      if (parameterOpen >= after && parameterOpen - after < 300 && parameterClose > parameterOpen && (!hasBody || parameterOpen < brace)) {
        const parameterText = code.slice(parameterOpen + 1, parameterClose);
        if (language === 'kotlin') {
          for (const match of parameterText.matchAll(/\b(?:val|var)\s+([A-Za-z_]\w*)/g)) {
            const position = parameterOpen + 1 + match.index;
            symbols.push({ name: match[1]!, kind: 'property', line: lineAt(starts, position), endLine: lineAt(starts, position), container: name });
          }
        } else {
          for (const part of parameterText.split(',')) {
            const member = /(?:[A-Za-z_]\w*[<>?\[\]]*\s+)+([A-Za-z_]\w*)\s*$/.exec(part);
            if (member) symbols.push({ name: member[1]!, kind: 'property', line: lineAt(starts, parameterOpen), endLine: lineAt(starts, parameterOpen), container: name });
          }
        }
      }
    }
    if (hasBody && end >= brace) ranges.push({ name: fullName, start: brace, end, depth: depth[brace]! + 1, kind });
  };

  if (language === 'go') {
    const pattern = /\btype\s+([A-Za-z_]\w*)\s+(struct|interface)\b/g;
    for (const match of code.matchAll(pattern)) addType(match[2] as StaticSymbolKind, match[1]!, match.index, match.index + match[0].length);
  } else {
    const pattern = /\b(class|interface|struct|record|enum|object)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)\b/g;
    for (const match of code.matchAll(pattern)) addType(match[1] as StaticSymbolKind, match[2]!, match.index, match.index + match[0].length);
  }

  const ownerAt = (position: number) => ranges.filter((range) => range.start < position && position < range.end).sort((a, b) => b.start - a.start)[0];
  const addFunction = (name: string, start: number, openParen: number, owner?: string, headerStart = start) => {
    const closeParen = matching(code, openParen, '(', ')');
    if (closeParen < 0) return;
    const body = code.indexOf('{', closeParen + 1);
    const semicolon = code.indexOf(';', closeParen + 1);
    const hasBody = body >= 0 && body - closeParen < 300 && (semicolon < 0 || body < semicolon);
    const end = hasBody ? matching(code, body, '{', '}') : semicolon >= 0 && semicolon - closeParen < 300 ? semicolon : closeParen;
    const header = normalizeSignature(source.slice(headerStart, Math.min(closeParen + 1, headerStart + 220)));
    symbols.push({ name, kind: owner ? 'method' : 'function', line: lineAt(starts, start), endLine: lineAt(starts, end < 0 ? closeParen : end), container: owner,
      signature: header, modifiers: /\b(async|suspend)\b/.test(header) ? [language === 'kotlin' ? 'suspend' : 'async'] : [],
      constructs: countConstructs(code.slice(start, Math.max(start, end + 1))) });
  };

  if (language === 'go') {
    const pattern = /\bfunc\s*(?:\(\s*\w+\s+\*?([A-Za-z_]\w*)[^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g;
    for (const match of code.matchAll(pattern)) addFunction(match[2]!, match.index, match.index + match[0].length - 1, match[1], match.index);
  } else if (language === 'kotlin') {
    const pattern = /\bfun\s+(?:(?:[A-Za-z_]\w*(?:<[^>]+>)?\.)?)([A-Za-z_]\w*)\s*\(/g;
    for (const match of code.matchAll(pattern)) {
      const owner = ownerAt(match.index);
      if (owner && depth[match.index]! !== owner.depth) continue;
      addFunction(match[1]!, match.index, match.index + match[0].length - 1, owner?.name, match.index);
    }
  } else {
    const pattern = /\b([A-Za-z_]\w*)\s*\(/g;
    const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'using', 'lock', 'new', 'return', 'throw', 'typeof', 'nameof', 'sizeof', 'base', 'this']);
    for (const match of code.matchAll(pattern)) {
      const name = match[1]!;
      if (reserved.has(name)) continue;
      const owner = ownerAt(match.index);
      if (!owner || depth[match.index]! !== owner.depth) continue;
      const before = code.slice(0, match.index);
      const headerStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'), before.lastIndexOf('\n')) + 1;
      const header = code.slice(headerStart, match.index).trim();
      if (!header || header.length > 180 || /[=.]\s*$/.test(header) || /\b(?:return|throw|new)\b/.test(header)) continue;
      if (!/[A-Za-z_]\w*\s+$/.test(code.slice(headerStart, match.index))) continue;
      const closeParen = matching(code, match.index + match[0].length - 1, '(', ')');
      if (closeParen < 0) continue;
      const tail = code.slice(closeParen + 1, Math.min(code.length, closeParen + 150));
      if (!/^\s*(?:throws\s+[\w.,\s]+|where\s+[\w\s:,<>]+|:\s*(?:base|this)\([^)]*\)\s*)?(?:\{|=>|;)/.test(tail)) continue;
      addFunction(name, match.index, match.index + match[0].length - 1, owner.name, headerStart);
    }
  }

  const propertyPattern = language === 'kotlin' ? /\b(val|var)\s+([A-Za-z_]\w*)/g
    : language === 'go' ? /^\s*([A-Za-z_]\w*)\s+\*?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?/gm
      : /\b([A-Za-z_]\w*(?:[<>?,\[\]]*)?)\s+([A-Za-z_]\w*)\s*(?=\{|;|=)/g;
  for (const match of code.matchAll(propertyPattern)) {
    const owner = ownerAt(match.index);
    if (!owner || depth[match.index]! !== owner.depth) continue;
    if (language === 'go' && owner.kind !== 'struct') continue;
    const name = match[2]!;
    if (['return', 'get', 'set', 'init', 'class', 'interface'].includes(name)) continue;
    symbols.push({ name, kind: language === 'kotlin' || code[match.index + match[0].length] === '{' ? 'property' : 'field', line: lineAt(starts, match.index), endLine: lineAt(starts, match.index), container: owner.name,
      signature: normalizeSignature(source.slice(match.index, Math.min(source.length, match.index + match[0].length))) });
  }
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return { language, namespace, imports: [...new Set(imports)], symbols };
}
