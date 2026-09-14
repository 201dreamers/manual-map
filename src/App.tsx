import { MapPinned } from 'lucide-react';
import { ControlPanel } from './components/ControlPanel';
import { HistoryDrawer } from './components/HistoryDrawer';
import { MapView } from './components/MapView';
import { RecenterButton } from './components/RecenterButton';
import { SettingsModal } from './components/SettingsModal';
import { TelemetryPanel } from './components/TelemetryPanel';
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <TopBar />

      <main className="relative flex-1 overflow-hidden">
        {mapboxToken ? (
          <MapView />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-slate-500">
            <MapPinned size={32} />
            <p className="text-sm">Add a Mapbox public token to load the map.</p>
          </div>
        )}
        <RecenterButton />
      </main>

      <TelemetryPanel />
      <ControlPanel />

      <HistoryDrawer />
      <SettingsModal />
      <ToastStack />
    </div>
  );
}

export default App;
