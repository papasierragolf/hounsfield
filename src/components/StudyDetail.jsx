import { useEffect, useRef, useState } from 'react';
import { getStudy, getImage, saveStudy, deleteStudy } from '../db.js';
import { blobToDataURL } from '../lib/image.js';
import { useEngine } from '../hooks/useEngine.js';
import { SYSTEM_PROMPT, buildUserPrompt, REPORT_FOOTER } from '../inference/prompts.js';
import { shareText } from '../lib/platform.js';
import Viewer from './Viewer.jsx';
import Report from './Report.jsx';

const MODALITY_LABEL = { xray: 'X-Ray', ct: 'CT', other: 'Study' };

const REGIONS = ['Chest', 'Abdomen', 'Head', 'Spine', 'Pelvis', 'Upper limb', 'Lower limb', 'Other'];

export default function StudyDetail({ studyId, autoAnalyze, onBack, onDeleted }) {
  const engine = useEngine();
  const [study, setStudy] = useState(null);
  const [imageUrls, setImageUrls] = useState([]);
  const [streamText, setStreamText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const autoStarted = useRef(false);
  const stopRequested = useRef(false);

  // Re-analyze context editor
  const [editMode, setEditMode] = useState(false);
  const [editContext, setEditContext] = useState('');
  const [editQuestion, setEditQuestion] = useState('');
  const [editModality, setEditModality] = useState('xray');
  const [editRegion, setEditRegion] = useState('Chest');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getStudy(studyId);
      if (cancelled || !s) return;
      setStudy(s);
      const urls = [];
      for (const id of s.imageIds) {
        const img = await getImage(id);
        if (img) urls.push(await blobToDataURL(img.blob));
      }
      if (!cancelled) setImageUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  async function analyze(current) {
    const s = current || study;
    if (!s || !imageUrls.length || engine.state !== 'ready') return;
    setEditMode(false);
    setAnalyzing(true);
    setError(null);
    setStreamText('');
    stopRequested.current = false;
    try {
      const result = await engine.generate(
        {
          imageDataUrls: imageUrls,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: buildUserPrompt(s),
          maxNewTokens: 1200,
        },
        (tok) => setStreamText((prev) => prev + tok)
      );
      // If the user stopped it, don't persist a truncated report — a partial
      // radiology read is misleading. Keep the previous report (if any).
      if (stopRequested.current) {
        setStreamText('');
        return;
      }
      const updated = {
        ...s,
        report: result.text + REPORT_FOOTER,
        model: engine.modelId,
        elapsedMs: result.elapsedMs,
        reportedAt: Date.now(),
      };
      await saveStudy(updated);
      setStudy(updated);
      setStreamText('');
    } catch (err) {
      if (!stopRequested.current) setError(String(err.message || err));
      setStreamText('');
    } finally {
      setAnalyzing(false);
      stopRequested.current = false;
    }
  }

  function stopAnalysis() {
    stopRequested.current = true;
    engine.stop();
  }

  function openEditMode() {
    setEditContext(study?.context || '');
    setEditQuestion(study?.question || '');
    setEditModality(study?.modality || 'xray');
    setEditRegion(study?.region || 'Chest');
    setEditMode(true);
  }

  async function runWithNewContext() {
    const updated = {
      ...study,
      context: editContext.trim(),
      question: editQuestion.trim(),
      modality: editModality,
      region: editRegion,
      report: null,
    };
    await saveStudy(updated);
    setStudy(updated);
    analyze(updated);
  }

  // Auto-run once after images load when arriving from the capture flow.
  useEffect(() => {
    if (autoAnalyze && !autoStarted.current && study && !study.report && imageUrls.length && engine.state === 'ready') {
      autoStarted.current = true;
      analyze(study);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [study, imageUrls, engine.state, autoAnalyze]);

  async function handleDelete() {
    if (!confirm('Delete this study and its images from the device?')) return;
    await deleteStudy(studyId);
    onDeleted();
  }

  async function share() {
    const outcome = await shareText('Hounsfield report', study.report).catch(() => null);
    if (outcome === 'copied') alert('Report copied to clipboard.');
  }

  if (!study) return <div className="empty">Loading…</div>;

  const modelNotReady = engine.state !== 'ready';

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ‹ Studies
      </button>

      {imageUrls.map((url, i) => (
        <Viewer
          key={i}
          src={url}
          modality={MODALITY_LABEL[study.modality]}
          region={study.region}
        />
      ))}

      {!editMode && (study.context || study.question) && (
        <div className="card">
          {study.context && <p className="hint">Context: {study.context}</p>}
          {study.question && <p className="hint">Question: {study.question}</p>}
        </div>
      )}

      {/* Re-analyze context editor */}
      {editMode && (
        <div className="card">
          <h2>Update context &amp; re-analyze</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            Edit the clinical context below. The previous report will be replaced.
          </p>

          <div className="seg" style={{ marginBottom: 14 }}>
            {[['xray', 'X-Ray'], ['ct', 'CT'], ['other', 'Other']].map(([val, label]) => (
              <button
                key={val}
                className={editModality === val ? 'active' : ''}
                onClick={() => setEditModality(val)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Body region</span>
            <select value={editRegion} onChange={(e) => setEditRegion(e.target.value)}>
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Clinical context</span>
            <textarea
              placeholder="e.g. 62-year-old with cough and fever for 5 days"
              value={editContext}
              onChange={(e) => setEditContext(e.target.value)}
              rows={3}
            />
          </label>

          <label className="field">
            <span>Specific question</span>
            <input
              type="text"
              placeholder="e.g. Is there a rib fracture?"
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
            />
          </label>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button
              className="btn btn-primary"
              disabled={modelNotReady || !imageUrls.length}
              onClick={runWithNewContext}
            >
              Run analysis
            </button>
            <button className="btn btn-secondary" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
          {modelNotReady && (
            <div className="notice" style={{ marginTop: 10 }}>
              Model not loaded — go to Settings first.
            </div>
          )}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {analyzing ? (
        <div className="card">
          <h2>Interpreting on-device…</h2>
          <Report text={streamText} streaming />
          <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={stopAnalysis}>
            Stop
          </button>
        </div>
      ) : study.report && !editMode ? (
        <div className="card">
          <Report text={study.report} />
          <div className="kv" style={{ marginTop: 12 }}>
            <span className="k">Model</span>
            <span className="v">{study.model?.split('/').pop()}</span>
          </div>
          {study.elapsedMs && (
            <div className="kv">
              <span className="k">Inference time</span>
              <span className="v">{(study.elapsedMs / 1000).toFixed(1)} s</span>
            </div>
          )}
        </div>
      ) : (
        !editMode && modelNotReady && (
          <div className="notice">
            The model isn't loaded yet — go to Settings to download/load MedGemma, then come back
            and tap Analyze.
          </div>
        )
      )}

      {!editMode && (
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className="btn btn-primary"
            disabled={analyzing || modelNotReady || !imageUrls.length}
            onClick={study.report ? openEditMode : () => analyze()}
          >
            {study.report ? 'Re-analyze' : 'Analyze'}
          </button>
          {study.report && !analyzing && (
            <button className="btn btn-secondary" onClick={share}>
              Share report
            </button>
          )}
        </div>
      )}
      <button className="btn btn-danger" style={{ marginTop: 10 }} onClick={handleDelete}>
        Delete study
      </button>
    </div>
  );
}
