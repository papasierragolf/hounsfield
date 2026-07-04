import { useCallback, useEffect, useState } from 'react';
import { listStudies, getImage, getSetting, setSetting } from './db.js';
import { blobToDataURL } from './lib/image.js';
import { DEFAULT_MODEL_ID, resolveModelIdForPlatform } from './inference/engine.js';
import { isNative } from './lib/platform.js';
import { useEngine } from './hooks/useEngine.js';
import DisclaimerGate from './components/DisclaimerGate.jsx';
import StudyList from './components/StudyList.jsx';
import CaptureView from './components/CaptureView.jsx';
import StudyDetail from './components/StudyDetail.jsx';
import SettingsView from './components/SettingsView.jsx';

const THEME_COLORS = { light: '#faf9f5', dark: '#262624' };

function applyTheme(pref) {
  const resolved =
    pref === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : pref;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
}

const TABS = [
  { key: 'studies', label: 'STUDIES', icon: 'M4 5h16v14H4z M4 9h16 M8 5v4' },
  { key: 'capture', label: 'NEW STUDY', icon: 'M12 5v14 M5 12h14' },
  { key: 'settings', label: 'SETTINGS', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1' },
];

function TabIcon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {d.split(' M').map((seg, i) => (
        <path key={i} d={(i ? 'M' : '') + seg} />
      ))}
    </svg>
  );
}

export default function App() {
  const engine = useEngine();
  const [accepted, setAccepted] = useState(null); // null = loading
  const [tab, setTab] = useState('studies');
  const [studies, setStudies] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [openStudyId, setOpenStudyId] = useState(null);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [theme, setTheme] = useState('light');
  const [hfToken, setHfToken] = useState('');

  const refreshStudies = useCallback(async () => {
    const list = await listStudies();
    setStudies(list);
    const firstIds = list.map((s) => s.imageIds?.[0]).filter(Boolean);
    const entries = await Promise.all(
      firstIds.map(async (id) => {
        const img = await getImage(id);
        return img ? [id, await blobToDataURL(img.thumb)] : null;
      })
    );
    setThumbs(Object.fromEntries(entries.filter(Boolean)));
  }, []);

  // Boot: read persisted settings, load studies, auto-load model if it was
  // loaded before (weights come from cache, so this is instant-ish offline).
  useEffect(() => {
    (async () => {
      const [ack, savedModel, everLoaded, savedTheme, savedToken] = await Promise.all([
        getSetting('disclaimerAccepted', false),
        getSetting('modelId', DEFAULT_MODEL_ID),
        getSetting('modelEverLoaded', false),
        getSetting('theme', 'light'),
        getSetting('hfToken', ''),
      ]);
      const resolvedModel = resolveModelIdForPlatform(savedModel);
      setAccepted(ack);
      setModelId(resolvedModel);
      setTheme(savedTheme);
      setHfToken(savedToken);
      await refreshStudies();
      // Native app ships with the model in the bundle — load it on every
      // launch. On the web, only auto-load once a download has succeeded.
      if (ack && (everLoaded || isNative())) engine.load(resolvedModel, { hfToken: savedToken });
    })();
  }, [engine, refreshStudies]);

  // Remember that a load succeeded so future launches restore automatically.
  useEffect(() => {
    if (engine.state === 'ready') setSetting('modelEverLoaded', true);
  }, [engine.state]);

  // Apply theme and track OS appearance changes while in "system" mode.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  if (accepted === null) return null;
  if (!accepted) {
    return (
      <DisclaimerGate
        onAccept={() => {
          setSetting('disclaimerAccepted', true);
          setAccepted(true);
        }}
      />
    );
  }

  const handleModelIdChange = (id) => {
    setModelId(id);
    setSetting('modelId', id);
  };

  const handleThemeChange = (t) => {
    setTheme(t);
    setSetting('theme', t);
  };

  const handleHfTokenChange = (t) => {
    setHfToken(t);
    setSetting('hfToken', t);
  };

  const handleCreated = (study) => {
    refreshStudies();
    setOpenStudyId(study.id);
    setAutoAnalyze(true);
    setTab('studies');
  };

  const statusDot =
    engine.state === 'ready' ? 'ready' : engine.state === 'loading' ? 'loading' : engine.state === 'error' ? 'error' : '';

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          Hounsfield <span className="hu">HU</span>
        </h1>
        <span className="model-chip">
          <span className={`dot ${statusDot}`} />
          {engine.state === 'ready'
            ? `MedGemma · ${engine.device}`
            : engine.state === 'loading'
              ? `loading ${Math.round(engine.overallProgress() * 100)}%`
              : 'model not loaded'}
        </span>
      </header>

      <main className="app-main">
        {tab === 'studies' &&
          (openStudyId ? (
            <StudyDetail
              studyId={openStudyId}
              autoAnalyze={autoAnalyze}
              onBack={() => {
                setOpenStudyId(null);
                setAutoAnalyze(false);
                refreshStudies();
              }}
              onDeleted={() => {
                setOpenStudyId(null);
                setAutoAnalyze(false);
                refreshStudies();
              }}
            />
          ) : (
            <StudyList studies={studies} thumbs={thumbs} onOpen={(id) => setOpenStudyId(id)} />
          ))}
        {tab === 'capture' && <CaptureView onCreated={handleCreated} />}
        {tab === 'settings' && (
          <SettingsView
            modelId={modelId}
            onModelIdChange={handleModelIdChange}
            onRestored={refreshStudies}
            theme={theme}
            onThemeChange={handleThemeChange}
            hfToken={hfToken}
            onHfTokenChange={handleHfTokenChange}
          />
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => {
              setTab(t.key);
              if (t.key !== 'studies') {
                setOpenStudyId(null);
                setAutoAnalyze(false);
              }
            }}
          >
            <TabIcon d={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
