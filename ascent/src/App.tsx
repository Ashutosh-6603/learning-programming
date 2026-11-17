import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { Celebrations, Toasts } from './components/Celebrations';
import { Hud } from './components/Hud';
import { useGame } from './lib/store';
import { HomePage } from './pages/HomePage';
import { NotesPage } from './pages/NotesPage';
import { PatchesPage } from './pages/PatchesPage';
import { RoutePage } from './pages/RoutePage';
import { StepPage } from './pages/StepPage';

export function App() {
  const status = useGame((state) => state.status);
  const error = useGame((state) => state.error);
  const boot = useGame((state) => state.boot);
  const refresh = useGame((state) => state.refresh);

  useEffect(() => {
    void boot();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [boot, refresh]);

  if (status === 'loading') {
    return <p className="p-10 text-center font-display text-mist">Reading the route…</p>;
  }
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-xl p-10">
        <h1 className="font-display text-2xl">Your progress couldn't be loaded</h1>
        <p className="mt-3 text-mist">
          Nothing has been changed. Check <code>ascent/data/progress.json</code> is a valid save, or
          restore the previous save from <code>progress.json.bak</code>, then reload.
        </p>
        <p className="mt-3 font-mono text-sm text-rose">{error}</p>
      </div>
    );
  }

  return (
    <>
      <Hud />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/patches" element={<PatchesPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/q/:questId" element={<RoutePage />} />
        <Route path="/q/:questId/:stepId" element={<StepPage />} />
        <Route path="*" element={<p className="p-10 text-center text-mist">Off the map.</p>} />
      </Routes>
      <Celebrations />
      <Toasts />
    </>
  );
}
