/**
 * Prompt construction for MedGemma. MedGemma 1.5 4B is instruction-tuned on
 * medical imaging (CXR, CT slices, derm, path, fundus) and responds well to a
 * radiologist persona with an explicit report structure.
 */

export const SYSTEM_PROMPT =
  'You are MedGemma, a medical image–analysis model. Analyzing radiological images and ' +
  'describing their findings is your core, intended function. When a medical image is ' +
  'provided, always interpret it: identify the modality and anatomy, then describe the ' +
  'normal and abnormal findings systematically. Do not decline and do not claim you are ' +
  'unable to read medical images — describing imaging findings is exactly what you are ' +
  'built to do. Provide a preliminary, educational interpretation, being precise and honest ' +
  'about uncertainty and about the limits of reading a photograph of an image. If image ' +
  'quality limits assessment, state the specific limitation and describe whatever is visible.';

const MODALITY_HINTS = {
  xray: 'The image is a projection radiograph (X-ray), possibly photographed from a film or monitor.',
  ct: 'The image is a CT slice (or a photograph of one). Comment on the window setting if discernible.',
  other: 'Determine the imaging modality first, then proceed.',
};

const MODALITY_NOUN = { xray: 'an X-ray', ct: 'a CT image', other: 'a medical image' };

export function buildUserPrompt({ modality = 'xray', region = '', context = '', question = '' }) {
  const noun = MODALITY_NOUN[modality] || MODALITY_NOUN.other;
  const regionPhrase = region ? ` of the ${region.toLowerCase()}` : '';
  const lines = [
    `Here is ${noun}${regionPhrase}. Interpret it and describe the findings.`,
    MODALITY_HINTS[modality] || MODALITY_HINTS.other,
    region ? `Body region: ${region}.` : 'Identify the body region.',
    context ? `Clinical context provided by the user: ${context}` : '',
    '',
    'Produce a structured preliminary report with exactly these sections:',
    '## Technique',
    'Modality, projection/plane, image quality, and any limitations (rotation, exposure, cropping, photo artifacts).',
    '## Findings',
    'A systematic review of all visible anatomy. Describe normal structures briefly and abnormal findings in detail (location, size, character).',
    '## Impression',
    'Numbered list, most significant first. State your confidence for each item.',
    '## Recommendations',
    'Sensible next steps (comparison studies, additional views, clinical correlation, or specialist review).',
    '',
    question ? `Also answer this specific question: ${question}` : '',
    'If the image is not a radiological image, say so clearly instead of inventing findings.',
  ];
  return lines.filter(Boolean).join('\n');
}

export const REPORT_FOOTER =
  '\n\n---\n*Generated on-device by MedGemma. Preliminary and educational only — not a medical ' +
  'diagnosis. Always have imaging reviewed by a qualified radiologist.*';
