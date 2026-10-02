import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useSimulationStore } from '../store/simulationStore';
import { Z_TOAST } from './ui';
import type { ToastKind } from '../types/domain';

/*
  These sit over a live map, which can be anything from a white motorway to a dark park,
  so a 15% tint was legible against some tiles and invisible against others - an error is
  the one message that must never be missed.

  The fill is now frosted rather than flat: a blurred, saturated backdrop under a dark
  tint, with a hairline top highlight so it reads as a pane of glass sitting above the
  map instead of a sticker pasted onto it. Legibility is preserved by keeping the tint
  dark and mostly opaque - the map shows through as texture, never as colour. At 80% over
  the worst case, a white tile, the error fill still holds about 6:1 against its text.
*/
const GLASS =
  'backdrop-blur-xl backdrop-saturate-150 ' +
  '[box-shadow:inset_0_1px_0_rgb(255_255_255/0.14),0_12px_32px_-12px_rgb(2_6_23/0.7)]';

const STYLES: Record<ToastKind, { className: string; Icon: typeof Info }> = {
  // Rose rather than red: the alarm is carried by the icon and the wording, and a
  // saturated red over a moving map reads as an emergency the app cannot actually have.
  error: {
    className: `bg-rose-900/80 text-rose-50 ring-rose-200/25 ${GLASS}`,
    Icon: AlertCircle,
  },
  info: {
    className: `bg-slate-900/75 text-slate-100 ring-white/15 ${GLASS}`,
    Icon: Info,
  },
  success: {
    className: `bg-emerald-900/80 text-emerald-50 ring-emerald-200/25 ${GLASS}`,
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
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-medium ring-1 ${className}`}
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
