'use client';

// Settings — a small modal sheet. Today it holds the haptics switch (feature-
// detected: iOS Safari has no web vibration, so the switch explains itself and
// disables) and a plain-language readout of where the data is coming from.

import { useEffect, useRef, useState } from 'react';
import type { DashboardState } from '../lib/types';
import { canVibrate, haptic } from '../lib/haptics';

export default function SettingsSheet({
  state, hapticsOn, onHaptics, onClose,
}: { state: DashboardState | null; hapticsOn: boolean; onHaptics: (on: boolean) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Safe to read at init: the sheet only mounts client-side, after a click.
  const [supported] = useState(() => canVibrate());

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const source = state?.demo ? 'Demo seed (synthetic, deterministic)' : state ? `${state.provider} · ${state.meta.llm}` : '—';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title" id="haptics-label">Haptic alerts</div>
            <div className="setting-sub">
              {supported
                ? 'A short buzz for a new ARMED alert or a fired signal, and a tick on key toggles. Off by default if your device asks for reduced motion.'
                : 'This browser has no web vibration (iOS Safari doesn’t). Alerts stay visual — nothing breaks.'}
            </div>
          </div>
          <button
            role="switch" aria-checked={supported && hapticsOn} aria-labelledby="haptics-label"
            className={`switch ${supported && hapticsOn ? 'on' : ''}`}
            disabled={!supported} onClick={() => onHaptics(!hapticsOn)}
          ><span className="knob" /></button>
        </div>
        {supported && hapticsOn && (
          <button className="ghost-btn" onClick={() => haptic('signal')}>Test haptic</button>
        )}

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Data source</div>
            <div className="setting-sub">{source}</div>
          </div>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Execution</div>
            <div className="setting-sub">{state?.meta.liveTrading ? 'LIVE' : 'Paper / modeled only — live trading is off.'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
