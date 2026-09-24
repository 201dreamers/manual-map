import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { Z_TOAST } from './ui';
import type { ToastKind } from '../types/domain';

/*
  These sit over a live map, which can be anything from a white motorway to a dark park,
  so a 15% tint was legible against some tiles and invisible against others - an error is
  the one message that must never be missed. Each kind is now an opaque fill with white
  text and a drop shadow to lift it off the map, rather than a wash that borrows the
  map's own colour. Error carries the strongest fill of the three.
*/
const STYLES: Record<ToastKind, { className: string; Icon: typeof Info }> = {
  error: {
    className:
      'bg-red-600 text-white ring-red-300/70 [box-shadow:0_10px_30px_-8px_rgb(2_6_23/0.85)]',
    Icon: AlertCircle,
  },
  info: {
    className:
      'bg-slate-800 text-slate-100 ring-slate-500/70 [box-shadow:0_10px_30px_-10px_rgb(2_6_23/0.8)]',
    Icon: Info,
  },
  success: {
    className:
      'bg-emerald-600 text-white ring-emerald-300/70 [box-shadow:0_10px_30px_-10px_rgb(2_6_23/0.8)]',
    Icon: CheckCircle2,
  },
};

export function ToastStack() {
  const toasts = useSimulationStore((state) => state.toasts);
  const dismissToast = useSimulationStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-x-3 top-0 ${Z_TOAST} flex flex-col gap-2`}
      // Standalone mode draws under the status bar, so the first toast needs the inset.
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      {toasts.map((toast) => {
        const { className, Icon } = STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 ${className}`}
          >
            <Icon size={20} className="mt-px shrink-0" />
            <p className="flex-1 leading-snug">{toast.text}</p>
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
