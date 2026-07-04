export default function DisclaimerGate({ onAccept }) {
  return (
    <div className="gate">
      <div className="gate-inner">
        <div className="logo">🩻</div>
        <h1>
          Hounsfield <span className="hu">HU</span>
        </h1>
        <p className="tagline">On-device radiology assistant, powered by MedGemma.</p>
        <ul>
          <li>
            <strong>Not a medical device.</strong> Output is preliminary and educational — never a
            diagnosis. Always consult a qualified radiologist or physician.
          </li>
          <li>
            <strong>Everything stays on this device.</strong> Images, reports, and history are
            stored locally. The only network use is the one-time model download.
          </li>
          <li>
            <strong>You control backups.</strong> Export your data whenever you like to iCloud
            Drive, Google Drive, or any storage you choose.
          </li>
          <li>
            <strong>~2.5 GB model download.</strong> MedGemma runs locally; a Wi-Fi connection is
            recommended for the first-time download.
          </li>
        </ul>
        <button className="btn btn-primary" onClick={onAccept}>
          I understand — continue
        </button>
      </div>
    </div>
  );
}
