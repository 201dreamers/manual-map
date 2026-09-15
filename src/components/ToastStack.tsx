import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import type { ToastKind } from '../types/domain';

const STYLES: Record<ToastKind, { className: string; Icon: typeof Info }> = {
  error: { className: 'bg-red-500/15 text-red-200 ring-red-500/40', Icon: AlertCircle },
  info: { className: 'bg-slate-800 text-slate-200 ring-slate-600', Icon: Info },
  success: { className: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40', Icon: CheckCircle2 },
};

export function ToastStack() {
  const toasts = useSimulationStore((state) => state.toasts);
  const dismissToast = useSimulationStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-3 top-0 z-50 flex flex-col gap-2"
      // Standalone mode draws under the status bar, so the first toast needs the inset.
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      {toasts.map((toast) => {
        const { className, Icon } = STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 backdrop-blur ${className}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1">{toast.text}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1 active:scale-95"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
