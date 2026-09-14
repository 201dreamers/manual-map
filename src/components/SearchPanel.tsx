import { useState } from 'react';
import { Flag, Loader2, MapPin, Plus, Search, X } from 'lucide-react';
import { MIN_SEARCH_LENGTH, useSimulationStore, type SearchRole } from '../store/simulationStore';

const ROLE_ACTIONS: Array<{ role: SearchRole; label: string; Icon: typeof MapPin }> = [
  { role: 'start', label: 'Start', Icon: MapPin },
  { role: 'via', label: 'Via', Icon: Plus },
  { role: 'end', label: 'End', Icon: Flag },
];

/** Address search for the planning drawer; a chosen result becomes a stop (D-3). */
export function SearchPanel() {
  const searchQuery = useSimulationStore((state) => state.searchQuery);
  const searchResults = useSimulationStore((state) => state.searchResults);
  const isSearching = useSimulationStore((state) => state.isSearching);
  const searchError = useSimulationStore((state) => state.searchError);
  const setSearchQuery = useSimulationStore((state) => state.setSearchQuery);
  const clearSearch = useSimulationStore((state) => state.clearSearch);
  const applySearchResult = useSimulationStore((state) => state.applySearchResult);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isActive = searchQuery.trim().length >= MIN_SEARCH_LENGTH;

  return (
    <div className="border-b border-slate-700">
      <div className="flex items-center gap-2 px-3 py-2">
        <Search size={16} className="shrink-0 text-slate-500" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setExpandedId(null);
          }}
          placeholder="Search address or place"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search for an address"
          className="min-h-[44px] w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
        {isSearching && <Loader2 size={15} className="shrink-0 animate-spin text-sky-400" />}
        {searchQuery.length > 0 && !isSearching && (
          <button
            type="button"
            onClick={() => {
              clearSearch();
              setExpandedId(null);
            }}
            aria-label="Clear search"
            className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-lg text-slate-500 active:scale-95"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {searchError && (
        <p className="px-3 pb-2 text-xs leading-relaxed text-red-400">{searchError}</p>
      )}

      {isActive && !searchError && !isSearching && searchResults.length === 0 && (
        <p className="px-3 pb-2 text-xs text-slate-500">No places found.</p>
      )}

      {isActive && searchResults.length > 0 && (
        <ul className="max-h-56 overflow-y-auto border-t border-slate-800">
          {searchResults.map((result) => (
            <li key={result.id} className="border-b border-slate-800 last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === result.id ? null : result.id)}
                aria-expanded={expandedId === result.id}
                className="flex min-h-[48px] w-full flex-col justify-center px-3 py-1.5 text-left active:bg-slate-800"
              >
                <span className="truncate text-xs text-slate-100">{result.name}</span>
                {result.address && (
                  <span className="truncate text-[11px] text-slate-500">{result.address}</span>
                )}
              </button>

              {expandedId === result.id && (
                <div className="flex gap-1.5 px-3 pb-2">
                  {ROLE_ACTIONS.map(({ role, label, Icon }) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => {
                        setExpandedId(null);
                        void applySearchResult(result, role);
                      }}
                      className="flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-slate-800 text-[11px] font-medium text-slate-200 ring-1 ring-slate-700 active:scale-95"
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
