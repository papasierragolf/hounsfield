/**
 * Minimal markdown renderer for MedGemma reports (headings, lists, bold,
 * italic, hr). Deliberately tiny instead of pulling a full markdown dep.
 */
function inline(text, key) {
  const parts = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={`${key}-b${i++}`}>{m[2]}</strong>);
    else parts.push(<em key={`${key}-i${i++}`}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Report({ text, streaming = false }) {
  const lines = (text || '').split('\n');
  const blocks = [];
  let list = null;
  let listType = null;

  const flushList = () => {
    if (!list) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`l${blocks.length}`}>
        {list.map((item, j) => (
          <li key={j}>{inline(item, `l${blocks.length}-${j}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    const ul = line.match(/^[-*•]\s+(.*)/);

    if (h) {
      flushList();
      blocks.push(<h2 key={i}>{inline(h[2], `h${i}`)}</h2>);
    } else if (ol) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      (list = list || []).push(ol[1]);
    } else if (ul) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      (list = list || []).push(ul[1]);
    } else if (line === '---' || line === '***') {
      flushList();
      blocks.push(<hr key={i} />);
    } else if (line) {
      flushList();
      blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
    }
  });
  flushList();

  return (
    <div className="report">
      {blocks}
      {streaming && <span className="cursor-blink">▌</span>}
    </div>
  );
}
