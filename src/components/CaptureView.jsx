import { useRef, useState } from 'react';
import { ingestImageFile, blobToDataURL } from '../lib/image.js';
import { saveStudy, saveImage, uid } from '../db.js';

const REGIONS = ['Chest', 'Abdomen', 'Head', 'Spine', 'Pelvis', 'Upper limb', 'Lower limb', 'Other'];

/**
 * New-study flow: capture from camera (iOS `capture` attribute opens the
 * camera directly) or pick from the photo library, add clinical context,
 * then hand off for on-device analysis.
 */
export default function CaptureView({ onCreated }) {
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const [items, setItems] = useState([]); // {id, blob, thumb, preview}
  const [modality, setModality] = useState('xray');
  const [region, setRegion] = useState('Chest');
  const [context, setContext] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function addFiles(fileList) {
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) {
        const { blob, thumb, width, height } = await ingestImageFile(file);
        const preview = await blobToDataURL(thumb);
        setItems((prev) => [...prev, { id: uid(), blob, thumb, width, height, preview }]);
      }
    } catch (err) {
      setError(`Could not read image: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function createStudy() {
    setBusy(true);
    try {
      const studyId = uid();
      const imageIds = [];
      for (const item of items) {
        const imageId = uid();
        await saveImage({
          id: imageId,
          studyId,
          blob: item.blob,
          thumb: item.thumb,
          width: item.width,
          height: item.height,
        });
        imageIds.push(imageId);
      }
      const study = {
        id: studyId,
        createdAt: Date.now(),
        modality,
        region,
        context: context.trim(),
        question: question.trim(),
        imageIds,
        report: null,
        model: null,
        elapsedMs: null,
      };
      await saveStudy(study);
      onCreated(study);
    } catch (err) {
      setError(`Could not save study: ${err.message || err}`);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Images</h2>
        {items.length > 0 && (
          <div className="thumb-grid">
            {items.map((it) => (
              <div className="thumb" key={it.id}>
                <img src={it.preview} alt="" />
                <button
                  className="rm"
                  aria-label="Remove image"
                  onClick={() => setItems((prev) => prev.filter((p) => p.id !== it.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="btn btn-secondary" disabled={busy} onClick={() => cameraRef.current.click()}>
            📷 Camera
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => libraryRef.current.click()}>
            🖼 Library
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="hint" style={{ marginTop: 10 }}>
          Photograph the film/monitor squarely, fill the frame, avoid glare. Images are processed
          and stored only on this device.
        </p>
      </div>

      <div className="card">
        <h2>Study details</h2>
        <div className="seg">
          {[
            ['xray', 'X-Ray'],
            ['ct', 'CT'],
            ['other', 'Other'],
          ].map(([val, label]) => (
            <button
              key={val}
              className={modality === val ? 'active' : ''}
              onClick={() => setModality(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Body region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Clinical context (optional)</span>
          <textarea
            placeholder="e.g. 62-year-old with cough and fever for 5 days"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Specific question (optional)</span>
          <input
            type="text"
            placeholder="e.g. Is there a rib fracture?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
      </div>

      {error && <div className="error-box">{error}</div>}

      <button className="btn btn-primary" disabled={!items.length || busy} onClick={createStudy}>
        {busy ? 'Working…' : `Create study${items.length ? ` (${items.length} image${items.length > 1 ? 's' : ''})` : ''}`}
      </button>
    </div>
  );
}
