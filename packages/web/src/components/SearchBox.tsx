import React, { useMemo, useState } from 'react';
import { translate } from '../i18n.js';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

interface SearchBoxProps {
  onFocusNode: (id: string) => void;
  onFocusDependency: (id: string) => void;
}

interface SearchResult { id: string; name: string; path: string; kind: 'component' | 'module' | 'library'; score: number; }
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();

export const SearchBox: React.FC<SearchBoxProps> = ({ onFocusNode, onFocusDependency }) => {
  const locale = useGrimoireStore((s) => s.locale);
  const graph = useGrimoireStore((s) => s.graph);
  const query = useGrimoireStore((s) => s.searchQuery);
  const setQuery = useGrimoireStore((s) => s.setSearchQuery);
  const selectNode = useGrimoireStore((s) => s.selectNode);
  const selectDependency = useGrimoireStore((s) => s.selectDependency);
  const setFilter = useGrimoireStore((s) => s.setFilter);
  const setDiagnosticFilter = useGrimoireStore((s) => s.setDiagnosticFilter);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const value = normalize(query);
    if (!value) return [];
    const tokens = value.split(/\s+/).filter(Boolean);
    const rank = (name: string, file: string): number | null => {
      const n = normalize(name); const f = normalize(file);
      if (!tokens.every((token) => n.includes(token) || f.includes(token))) return null;
      if (n === value) return 0;
      if (n.startsWith(value)) return 1;
      if (n.includes(value)) return 2;
      if (f.split('/').pop()?.startsWith(value)) return 3;
      return 4;
    };
    const found: SearchResult[] = [];
    for (const node of graph?.nodes || []) {
      const score = rank(node.name, node.file || '');
      if (score !== null) found.push({ id: node.id, name: node.name, path: node.file || node.cluster || '', kind: node.kind === 'component' ? 'component' : 'module', score });
    }
    for (const dependency of graph?.dependencies || []) {
      const score = rank(dependency.name, '');
      if (score !== null) found.push({ id: dependency.id, name: dependency.name, path: dependency.version || '', kind: 'library', score });
    }
    return found.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name) || a.path.localeCompare(b.path)).slice(0, 12);
  }, [query, graph]);

  const choose = (result: SearchResult) => {
    setFilter('all'); setDiagnosticFilter('all');
    if (result.kind === 'library') { selectDependency(result.id); onFocusDependency(result.id); }
    else { selectNode(result.id); onFocusNode(result.id); }
    setQuery(''); setOpen(false); setActive(0);
  };

  return <div className="search-box" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span className="search-icon" aria-hidden="true">⌕</span>
    <input id="node-search" className="search-input" type="search" role="combobox" autoComplete="off" value={query}
      placeholder={translate(locale, 'searchPlaceholder')} aria-label={translate(locale, 'searchPlaceholder')}
      aria-expanded={open && Boolean(query.trim())} aria-controls="grimoire-search-results"
      aria-activedescendant={open && results[active] ? `search-result-${active}` : undefined}
      onFocus={() => { if (query.trim()) setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.max(0, Math.min(index + 1, results.length - 1))); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
        else if (event.key === 'Enter' && open && results[active]) { event.preventDefault(); choose(results[active]); }
        else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      }} />
    {open && query.trim() && <div id="grimoire-search-results" className="search-results" role="listbox">
      {results.length ? results.map((result, index) => <button id={`search-result-${index}`} role="option" aria-selected={index === active}
        key={result.id} className={`search-result ${index === active ? 'active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(result)}>
        <span className="search-result-main"><strong>{result.name}</strong><small>{translate(locale, result.kind === 'library' ? 'searchLibrary' : result.kind === 'component' ? 'searchComponent' : 'searchModule')}</small></span>
        <span className="search-result-path">{result.path}</span>
      </button>) : <div className="search-empty">{translate(locale, 'searchNoResults')}</div>}
      <div className="search-hint">{translate(locale, 'searchHint')}</div>
    </div>}
  </div>;
};
