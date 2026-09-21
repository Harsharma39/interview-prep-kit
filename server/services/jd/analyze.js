const normalizeLine = (line) => line.replace(/^[\s•*-]+/, '').replace(/\s+/g, ' ').trim();

const REQUIREMENT_SECTION = /^(requirements?|qualifications?|what you bring|what we.re looking for)\s*:?[\s]*$/i;
const SECTION_END = /^(responsibilities|what you.ll do|about the role|benefits|what we offer)\b/i;
const REQUIREMENT_MARKER = /^(required|must(?: have)?|essential|qualifications?)\s*[:\-]?\s*(.*)$/i;
const BONUS_MARKER = /^(bonus|nice to have|preferred|plus)\s*[:\-]?\s*(.*)$/i;
const REQUIREMENT_HINT = /\b(must have|required|nice to have|preferred|bonus|years? of experience|experience with|proficien(?:t|cy) in|knowledge of)\b/i;
const BEHAVIOURAL_HINT = /\b(communication|collaborat|leadership|mentorship|teamwork|stakeholder|adaptab|problem.solv)\b/i;
const DOMAIN_HINT = /\b(domain|industry|healthcare|finance|retail|legal|marketing)\b/i;
const NICE_HINT = /\b(nice to have|preferred|bonus|plus)\b/i;

const deriveKind = (text) => (BEHAVIOURAL_HINT.test(text) ? 'behavioural' : DOMAIN_HINT.test(text) ? 'domain' : 'technical');

const derivePriority = (line, bonus) => (bonus ? 'nice' : NICE_HINT.test(line) ? 'nice' : 'must');

// Classifies a single normalized line as a requirement (or not) with no external state.
const classifyLine = (line) => {
  if (line.length < 8 || line.length > 300) return null;
  const marker = line.match(REQUIREMENT_MARKER);
  const bonus = line.match(BONUS_MARKER);
  if (!marker && !bonus) return null;
  const text = normalizeLine(marker?.[2] || bonus?.[2] || line);
  if (!text) return null;
  return { text, kind: deriveKind(text), priority: derivePriority(line, bonus) };
};

const analyzeJobDescription = (jd) => {
  const text = String(jd || '').replace(/\r/g, '').trim();
  const lines = text.split('\n').map(normalizeLine).filter(Boolean);
  const titleLine = lines.find((line) => /\b(engineer|developer|designer|manager|analyst|scientist|recruiter|architect|lead|director)\b/i.test(line));
  const title = titleLine && titleLine.length < 120 ? titleLine : 'Interview preparation role';
  const seniorityMatch = text.match(/\b(intern|junior|mid(?:-level)?|senior|staff|principal|lead|director|manager)\b/i);
  const locationMatch = text.match(/(?:location|based in|office in)\s*[:\-]?\s*([^\n,.]{2,60})/i);
  const requirements = [];
  const seen = new Set();
  let inRequirementsSection = false;
  lines.forEach((line) => {
    if (REQUIREMENT_SECTION.test(line)) {
      inRequirementsSection = true;
      return;
    }
    if (SECTION_END.test(line)) inRequirementsSection = false;
    const marker = line.match(REQUIREMENT_MARKER);
    const bonus = line.match(BONUS_MARKER);
    const isRequirement = marker || bonus || inRequirementsSection || REQUIREMENT_HINT.test(line);
    if (!isRequirement) return;
    const requirementText = normalizeLine((marker || bonus)?.[2] || line.replace(/^(requirements?|responsibilities?)\s*[:\-]?\s*/i, ''));
    if (requirementText && !seen.has(requirementText.toLowerCase())) {
      seen.add(requirementText.toLowerCase());
      const classified = classifyLine(line) || { text: requirementText, kind: deriveKind(requirementText), priority: derivePriority(line, bonus) };
      const kind = deriveKind(classified.text);
      requirements.push({ id: `r${requirements.length + 1}`, text: classified.text, kind, priority: classified.priority });
    }
  });
  const responsibilities = lines.filter((line) => /^(responsibilit(?:y|ies)|what you.ll do|you will)\b/i.test(line)).map((line) => line.replace(/^[^:]+:\s*/i, '')).filter(Boolean);
  return { title, seniority: seniorityMatch ? seniorityMatch[1] : '', location: locationMatch ? locationMatch[1].trim() : '', responsibilities, requirements, jd_chars: text.length };
};

module.exports = { analyzeJobDescription };