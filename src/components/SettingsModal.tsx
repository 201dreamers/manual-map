import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, FlipHorizontal2, KeyRound, Loader2, Minus, Plus, RefreshCw, Ruler, X } from 'lucide-react';
import { checkForUpdate, type UpdateCheck } from '../lib/appUpdate';
import { displaySpeed, formatTimestamp, speedFromDisplay, speedLabel } from '../lib/format';
import { validatePublicToken } from '../lib/token';
import { GLASS_PANEL, Z_MODAL, INLINE_ERROR } from './ui';
import {
  MAX_SPEED_STEP_KMH,
  MAX_STEP_ANIMATION_MS,
  MAX_STEP_METERS,
  MIN_STEP_ANIMATION_MS,
  MIN_STEP_METERS,
  SPEED_STEP_PRESETS_KMH,
  useSimulationStore,
  type StepDirection,
} from '../store/simulationStore';

const STEP_PRESETS_METERS = [125, 250, 500, 1000];
/** Glide lengths that stay readable without holding up the next tap. */
const GLIDE_PRESETS_MS = [300, 700, 1200, 2000];

function PresetRow({
  presets,
  value,
  format,
  onPick,
}: {
  presets: number[];
  value: number;
  format: (preset: number) => string;
  onPick: (preset: number) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onPick(preset)}
          className={`min-h-[32px] flex-1 rounded-lg px-1 text-[11px] font-mono ring-1 transition active:scale-95 ${
            value === preset
              ? 'bg-sky-500/20 text-sky-200 ring-sky-500/50'
              : 'bg-slate-800 text-slate-400 ring-slate-700'
          }`}
        >
          {format(preset)}
        </button>
      ))}
    </div>
  );
}

/**
 * How far one press of the speed +/- pair moves the speed. The buttons replaced a
 * slider, which asked for a precise drag while driving; making the increment
 * configurable is what lets one pair of buttons serve both careful planning and coarse
 * adjustment at speed.
 */
/**
 * The speed increments, one per direction, plus the unit system that every readout in
 * the app follows. Typed in whatever units are currently displayed and stored in km/h,
 * so switching to imperial does not silently rewrite what the buttons do.
 */
function SpeedStepField() {
  const config = useSimulationStore((state) => state.config);
  const setSpeedStep = useSimulationStore((state) => state.setSpeedStep);
  const setUnitSystem = useSimulationStore((state) => state.setUnitSystem);

  const unit = speedLabel(config.unitSystem);
  const fields = [
    { direction: 1 as StepDirection, id: 'speed-step-up', label: 'Up', value: config.speedStepUpKmh },
    { direction: -1 as StepDirection, id: 'speed-step-down', label: 'Down', value: config.speedStepDownKmh },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={field.id} className="flex items-center gap-1.5 text-xs text-slate-400">
              {field.direction === 1 ? <Plus size={14} /> : <Minus size={14} />} {field.label}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={field.id}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_SPEED_STEP_KMH}
                step={1}
                value={Math.round(displaySpeed(field.value, config.unitSystem))}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) {
                    setSpeedStep(field.direction, speedFromDisplay(parsed, config.unitSystem));
                  }
                }}
                className="min-h-[44px] w-full rounded-xl bg-slate-800 px-3 text-center font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <span className="text-xs text-slate-500">{unit}</span>
            </div>
            <PresetRow
              presets={SPEED_STEP_PRESETS_KMH}
              value={field.value}
              format={(preset) => String(Math.round(displaySpeed(preset, config.unitSystem)))}
              onPick={(preset) => setSpeedStep(field.direction, preset)}
            />
          </div>
        ))}
      </div>

      {/*
        One switch for every unit the app shows - speed and distance both - rather than
        a separate toggle per quantity. It used to be a tap on the speedometer, but the
        dial is now a single target for play/pause, and a control that important cannot
        share a tap with a preference that is set once and forgotten.
      */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <Ruler size={14} /> Units
        </span>
        <div className="flex gap-1.5">
          {([
            { system: 'metric' as const, label: 'Metric', hint: 'km / km-h' },
            { system: 'imperial' as const, label: 'Imperial', hint: 'mi / mph' },
          ]).map((option) => (
            <button
              key={option.system}
              type="button"
              onClick={() => setUnitSystem(option.system)}
              aria-pressed={config.unitSystem === option.system}
              className={`flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-xl text-sm ring-1 transition active:scale-95 ${
                config.unitSystem === option.system
                  ? 'bg-sky-500/20 text-sky-200 ring-sky-500'
                  : 'bg-slate-800 text-slate-400 ring-slate-700'
              }`}
            >
              {option.label}
              <span className="text-[10px] text-slate-500">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepDistanceField({
  direction,
  label,
  value,
  glideMs,
}: {
  direction: StepDirection;
  label: string;
  value: number;
  glideMs: number;
}) {
  const setStepDistance = useSimulationStore((state) => state.setStepDistance);
  const setStepAnimationMs = useSimulationStore((state) => state.setStepAnimationMs);
  const inputId = direction === 1 ? 'step-forward' : 'step-back';
  const glideId = direction === 1 ? 'glide-forward' : 'glide-back';
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
      <PresetRow
        presets={STEP_PRESETS_METERS}
        value={value}
        format={(preset) => String(preset)}
        onPick={(preset) => setStepDistance(direction, preset)}
      />

      <label htmlFor={glideId} className="mt-1 text-xs text-slate-400">
        Glide
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={glideId}
          type="number"
          inputMode="numeric"
          min={MIN_STEP_ANIMATION_MS}
          max={MAX_STEP_ANIMATION_MS}
          step={50}
          value={glideMs}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) setStepAnimationMs(direction, parsed);
          }}
          className="min-h-[44px] w-full rounded-xl bg-slate-800 px-3 text-center font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <span className="text-xs text-slate-500">ms</span>
      </div>
      <PresetRow
        presets={GLIDE_PRESETS_MS}
        value={glideMs}
        format={(preset) => `${preset / 1000}s`}
        onPick={(preset) => setStepAnimationMs(direction, preset)}
      />
    </div>
  );
}

const UPDATE_MESSAGES: Record<UpdateCheck, string> = {
  updating: 'New version found. Reloading...',
  current: 'Already running the latest build.',
  unreachable: 'Could not reach the server. The installed build keeps running.',
  unsupported: 'Updates are only checked in the installed app.',
};

/**
 * iOS can relaunch an installed app from its snapshot without ever checking for a
 * new build, so the check is offered by hand. A found update reloads the page itself
 * once the new worker activates.
 */
function UpdateSection() {
  const [isChecking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<UpdateCheck | null>(null);

  const check = () => {
    setChecking(true);
    setOutcome(null);
    void checkForUpdate().then((result) => {
      setChecking(false);
      setOutcome(result);
    });
  };

  return (
    <section className="mb-5">
      <h3 className="mb-1 text-sm font-medium text-slate-200">App</h3>
      <p className="mb-3 text-xs text-slate-400">
        Build {formatTimestamp(__APP_BUILD__)}. An installed copy reloads itself once a
        check finds a newer one, which needs the server reachable.
      </p>
      <button
        type="button"
        onClick={check}
        disabled={isChecking}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-slate-800 px-3 text-sm text-slate-200 ring-1 ring-slate-700 active:scale-[0.98] disabled:opacity-60"
      >
        {isChecking ? (
          <Loader2 size={16} className="animate-spin text-sky-300" />
        ) : (
          <RefreshCw size={16} className="text-slate-400" />
        )}
        {isChecking ? 'Checking...' : 'Check for updates'}
      </button>
      {outcome && (
        <p
          className={`mt-2 text-xs ${
            outcome === 'unreachable' ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          {UPDATE_MESSAGES[outcome]}
        </p>
      )}
    </section>
  );
}

export function SettingsModal() {
  const isOpen = useSimulationStore((state) => state.isSettingsOpen);
  const mapboxToken = useSimulationStore((state) => state.mapboxToken);
  const stepForwardMeters = useSimulationStore((state) => state.config.stepForwardMeters);
  const stepBackMeters = useSimulationStore((state) => state.config.stepBackMeters);
  const stepForwardAnimationMs = useSimulationStore(
    (state) => state.config.stepForwardAnimationMs,
  );
  const stepBackAnimationMs = useSimulationStore((state) => state.config.stepBackAnimationMs);
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
    <div
      className={`pointer-events-auto absolute inset-0 ${Z_MODAL} flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm`}
      // A tall modal grows to the full height, so the insets have to keep it clear of
      // the Dynamic Island at the top and the home indicator at the bottom.
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className={`max-h-full w-full max-w-sm overflow-y-auto rounded-2xl p-4 ${GLASS_PANEL}`}>
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

        {!isForced && <UpdateSection />}

        {!isForced && (
          <section className="mb-5">
            <h3 className="mb-1 text-sm font-medium text-slate-200">Controls</h3>
            <p className="mb-3 text-xs text-slate-400">
              Mirror flips the whole interface for left-handed use: the top controls and the
              distance panel swap corners, the zoom pair follows the menu, both drawers open
              from the other side, and the two thumb columns trade places.
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
              Mirror controls
              <span
                className={`ml-auto rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                  controlsMirrored ? 'bg-sky-500/20 text-sky-200' : 'bg-slate-800/70 text-slate-400'
                }`}
              >
                {controlsMirrored ? 'On' : 'Off'}
              </span>
            </button>
          </section>
        )}

        {!isForced && (
          <section className="mb-5">
            <h3 className="mb-1 text-sm font-medium text-slate-200">Steps</h3>
            <p className="mb-3 text-xs text-slate-400">
              Distance and glide length are configured independently for each direction.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StepDistanceField
                direction={-1}
                label="Back"
                value={stepBackMeters}
                glideMs={stepBackAnimationMs}
              />
              <StepDistanceField
                direction={1}
                label="Forward"
                value={stepForwardMeters}
                glideMs={stepForwardAnimationMs}
              />
            </div>
          </section>
        )}

        {!isForced && (
          <section className="mb-5">
            <h3 className="mb-1 text-sm font-medium text-slate-200">Speed</h3>
            <p className="mb-3 text-xs text-slate-400">
              How much one press of each speed button changes the speed, and which
              units every readout uses.
            </p>
            <SpeedStepField />
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

          {error && <p className={`mt-2 ${INLINE_ERROR}`}>{error}</p>}

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
