import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { validatePublicToken } from '../lib/token';
import { useSimulationStore } from '../store/simulationStore';

export function SettingsModal() {
  const isOpen = useSimulationStore((state) => state.isSettingsOpen);
  const mapboxToken = useSimulationStore((state) => state.mapboxToken);
  const openSettings = useSimulationStore((state) => state.openSettings);
  const setToken = useSimulationStore((state) => state.setToken);
  const removeToken = useSimulationStore((state) => state.removeToken);
  const pushToast = useSimulationStore((state) => state.pushToast);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // FR-6.3: the setup modal is forced open until a usable token exists.
  const isForced = !mapboxToken;
  if (!isOpen && !isForced) return null;

  const handleSave = () => {
    const validation = validatePublicToken(draft);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    setError(null);
    setToken(draft);
    setDraft('');
    pushToast('success', 'Mapbox token saved.');
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-800">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <KeyRound size={18} /> Mapbox token
          </h2>
          {!isForced && (
            <button
              type="button"
              onClick={() => openSettings(false)}
              aria-label="Close settings"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 active:scale-95 active:bg-slate-800"
            >
              <X size={20} />
            </button>
          )}
        </header>

        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          Paste a Mapbox <strong className="text-slate-200">public</strong> token (starts with
          <code className="mx-1 rounded bg-slate-800 px-1 font-mono">pk.</code>). It is stored only
          in this browser. Secret tokens (<code className="font-mono">sk.</code>) are rejected.
        </p>

        <input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          placeholder="pk.eyJ1Ijoi..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[44px] w-full rounded-xl bg-slate-800 px-3 font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        {mapboxToken && !error && (
          <p className="mt-2 truncate text-xs text-emerald-400">
            Active token: {mapboxToken.slice(0, 12)}...
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-sky-500 text-sm font-medium text-slate-950 active:scale-95"
          >
            Save token
          </button>
          {mapboxToken && (
            <button
              type="button"
              onClick={() => {
                removeToken();
                setDraft('');
                pushToast('info', 'Saved token cleared.');
              }}
              className="flex min-h-[44px] items-center justify-center rounded-xl bg-slate-800 px-4 text-sm text-slate-200 ring-1 ring-slate-700 active:scale-95"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
