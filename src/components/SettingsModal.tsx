import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, FlipHorizontal2, KeyRound, X } from 'lucide-react';
import { validatePublicToken } from '../lib/token';
import {
  MAX_STEP_METERS,
  MIN_STEP_METERS,
  useSimulationStore,
  type StepDirection,
} from '../store/simulationStore';

const STEP_PRESETS_METERS = [125, 250, 500, 1000];

function StepDistanceField({
  direction,
  label,
  value,
}: {
  direction: StepDirection;
  label: string;
  value: number;
}) {
  const setStepDistance = useSimulationStore((state) => state.setStepDistance);
  const inputId = direction === 1 ? 'step-forward' : 'step-back';
  const Icon = direction === 1 ? ChevronsRight : ChevronsLeft;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-xs text-slate-400">
        <Icon size={14} /> {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_STEP_METERS}
          max={MAX_STEP_METERS}
          step={10}
          value={value}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) setStepDistance(direction, parsed);
          }}
          className="min-h-[44px] w-full rounded-xl bg-slate-800 px-3 text-center font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <span className="text-xs text-slate-500">m</span>
      </div>
      <div className="flex gap-1.5">
        {STEP_PRESETS_METERS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setStepDistance(direction, preset)}
            className={`min-h-[32px] flex-1 rounded-lg px-1 text-[11px] font-mono ring-1 transition active:scale-95 ${
              value === preset
                ? 'bg-sky-500/20 text-sky-200 ring-sky-500/50'
                : 'bg-slate-800 text-slate-400 ring-slate-700'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsModal() {
  const isOpen = useSimulationStore((state) => state.isSettingsOpen);
  const mapboxToken = useSimulationStore((state) => state.mapboxToken);
  const stepForwardMeters = useSimulationStore((state) => state.config.stepForwardMeters);
  const stepBackMeters = useSimulationStore((state) => state.config.stepBackMeters);
  const controlsMirrored = useSimulationStore((state) => state.config.controlsMirrored);
  const setControlsMirrored = useSimulationStore((state) => state.setControlsMirrored);
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
      <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-800">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Settings</h2>
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

        {!isForced && (
          <section className="mb-5">
            <h3 className="mb-1 text-sm font-medium text-slate-200">Controls</h3>
            <p className="mb-3 text-xs text-slate-400">
              Mirror swaps the playback and step clusters at the bottom of the map. The speed
              slider spans the full width either way.
            </p>
            <button
              type="button"
              onClick={() => setControlsMirrored(!controlsMirrored)}
              aria-pressed={controlsMirrored}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-slate-800 px-3 text-sm text-slate-200 ring-1 ring-slate-700 active:scale-[0.98]"
            >
              <FlipHorizontal2
                size={16}
                className={controlsMirrored ? 'text-sky-300' : 'text-slate-400'}
              />
              Mirror bottom controls
              <span
                className={`ml-auto rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                  controlsMirrored ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-900 text-slate-500'
                }`}
              >
                {controlsMirrored ? 'On' : 'Off'}
              </span>
            </button>
          </section>
        )}

        {!isForced && (
          <section className="mb-5">
            <h3 className="mb-1 text-sm font-medium text-slate-200">Step distances</h3>
            <p className="mb-3 text-xs text-slate-400">
              Forward and backward steps are configured independently.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StepDistanceField direction={-1} label="Back" value={stepBackMeters} />
              <StepDistanceField direction={1} label="Forward" value={stepForwardMeters} />
            </div>
          </section>
        )}

        <section className="border-t border-slate-800 pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
            <KeyRound size={16} /> Mapbox token
          </h3>
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

          <div className="mt-3 flex gap-2">
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
        </section>

      </div>
    </div>
  );
}
