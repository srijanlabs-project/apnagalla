import { useEffect, useState } from 'react';
import splash from '../assets/splash.webp';

/** Shortest time the splash stays, so it doesn't just flicker on a fast phone. */
const MIN_MS = 1200;
const FADE_MS = 300;

/**
 * The ApnaGalla splash, shown once at app start over the app while it loads behind it.
 * Android shows the same green first (launch theme), so the hand-over is seamless.
 */
export default function Splash({ ready }: { ready: boolean }) {
  const [minDone, setMinDone] = useState(false);
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');

  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (ready && minDone && phase === 'show') setPhase('fade');
  }, [ready, minDone, phase]);

  // Separate step, so starting the fade doesn't cancel the removal.
  useEffect(() => {
    if (phase !== 'fade') return;
    const t = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;
  return (
    <div className={`app-splash${phase === 'fade' ? ' fading' : ''}`} role="img" aria-label="apna galla: naye zamane ka bahi-khata">
      <img src={splash} alt="" />
    </div>
  );
}
