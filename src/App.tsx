import { MapPinned } from 'lucide-react';
import { ControlPanel } from './components/ControlPanel';
import { HistoryDrawer } from './components/HistoryDrawer';
import { MapView } from './components/MapView';
import { PlanDrawer } from './components/PlanDrawer';
import { RecenterButton } from './components/RecenterButton';
import { SettingsModal } from './components/SettingsModal';
import { ToastStack } from './components/ToastStack';
import { TopBar } from './components/TopBar';
import { useAnimationLoop } from './lib/useAnimationLoop';
import { useWakeLock } from './lib/useWakeLock';
import { useSimulationStore } from './store/simulationStore';

function App() {
  const mapboxToken = useSimulationStore((state) => state.mapboxToken);
  const isPlaying = useSimulationStore((state) => state.config.isPlaying);

  useAnimationLoop();
  useWakeLock(isPlaying);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* The map fills the viewport; every control floats above it. */}
      <main className="relative h-full w-full overflow-hidden">
        {mapboxToken ? (
          <MapView />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-slate-500">
            <MapPinned size={32} />
            <p className="text-sm">Add a Mapbox public token to load the map.</p>
          </div>
        )}

        {/* Top overlay stack: the action row, then the status line under it. */}
        <div
          className="pointer-events-none absolute inset-x-3 top-0 flex flex-col gap-2"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <TopBar />
        </div>

        <PlanDrawer />
        <RecenterButton />
        <ControlPanel />
      </main>

      <HistoryDrawer />
      <SettingsModal />
      <ToastStack />
    </div>
  );
}

export default App;
