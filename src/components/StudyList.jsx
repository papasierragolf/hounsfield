const MODALITY_LABEL = { xray: 'X-Ray', ct: 'CT', other: 'Other' };

export default function StudyList({ studies, thumbs, onOpen }) {
  if (!studies.length) {
    return (
      <div className="empty">
        <div className="glyph">🩻</div>
        <p>No studies yet.</p>
        <p style={{ fontSize: 13 }}>Tap “New Study” to capture or import an image.</p>
      </div>
    );
  }
  return (
    <div>
      {studies.map((s) => (
        <button key={s.id} className="study-row" onClick={() => onOpen(s.id)}>
          {thumbs[s.imageIds?.[0]] ? (
            <img src={thumbs[s.imageIds[0]]} alt="" />
          ) : (
            <div style={{ width: 60, height: 60 }} />
          )}
          <div className="meta">
            <div className="title">
              {MODALITY_LABEL[s.modality] || 'Study'}
              {s.region ? ` · ${s.region}` : ''}
            </div>
            <div className="sub">
              {new Date(s.createdAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </div>
          </div>
          <span className={`badge ${s.report ? 'done' : 'pending'}`}>
            {s.report ? 'Reported' : 'Pending'}
          </span>
        </button>
      ))}
    </div>
  );
}
