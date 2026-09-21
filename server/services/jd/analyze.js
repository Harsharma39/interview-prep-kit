const normalizeLine = (line) => String(line || '').replace(/^[\s•*-]+/, '').replace(/\s+/g, ' ').trim();
const normalKey = (value) => normalizeLine(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bskills?\b/g, '').trim();
const semanticKey = (value) => normalKey(value).replace(/\b(?:experience|knowledge|proficiency|familiarity|expertise)\b/g, '').replace(/\s+/g, ' ').trim();
const REQUIREMENT_SECTION = /^(requirements?|qualifications?|skills?|what you bring|what we.?re looking for|technical skills?)\s*:?$/i;
const SECTION_END = /^(responsibilities|what you.?ll do|about the role|benefits|what we offer)\b/i;
const REQUIREMENT_MARKER = /^(required|must(?: have)?|essential|qualifications?)\s*[:\-]?\s*(.*)$/i;
const BONUS_MARKER = /^(bonus|nice to have|preferred|plus)\s*[:\-]?\s*(.*)$/i;
const REQUIREMENT_HINT = /\b(must have|required|nice to have|preferred|bonus|years? of experience|experience with|proficien(?:t|cy) in|knowledge of|familiarity with|expertise in|understanding of|ability to)\b/i;
const BEHAVIOURAL_HINT = /\b(communication|collaborat|leadership|mentorship|teamwork|stakeholder|adaptab|problem.solv)\b/i;
const DOMAIN_HINT = /\b(domain|industry|healthcare|finance|retail|legal|marketing)\b/i;
const NICE_HINT = /\b(nice to have|preferred|bonus|plus)\b/i;
const HEADING = /^(skills?|requirements?|qualifications?|responsibilities|benefits|about us|about the role|what we offer|who you are|what you.?ll do)$/i;
const BOILERPLATE = /\b(we are looking for|ideal candidate|join our team|equal opportunity|fast[- ]paced environment|competitive salary|company culture)\b/i;
const LEADING_CUE = /^(?:strong |solid |good |excellent |hands-on )?(?:experience with|experience in|proficiency in|knowledge of|familiarity with|expertise in|understanding of|skills? in)\s+/i;

const deriveKind = (text) => (BEHAVIOURAL_HINT.test(text) ? 'behavioural' : DOMAIN_HINT.test(text) ? 'domain' : 'technical');
const derivePriority = (line, bonus) => (bonus || NICE_HINT.test(line) ? 'nice' : 'must');
const isMeaningful = (value) => {
  const text = normalizeLine(value).replace(/[.:;]+$/, '');
  if (text.length < 2 || text.length > 140 || HEADING.test(text) || BOILERPLATE.test(text)) return false;
  const words = text.match(/[a-z0-9][a-z0-9+.#/-]*/gi) || [];
  return words.length > 0 && !/^(the|and|or|with|skills?)$/i.test(text);
};

// Splits list-shaped requirement content without needing a catalogue of technologies.
const splitList = (value) => normalizeLine(value)
  .replace(/\b(?:preferably|including|such as)\b/gi, ',')
  .replace(/\s+(?:along with|as well as)\s+/gi, ',')
  .split(/\s*,\s*|\s+(?:and|&)\s+/i)
  .map((part) => part.replace(/^(?:with|in)\s+/i, '').replace(/[.;:]+$/, '').trim())
  .filter(isMeaningful);

const atomize = (raw) => {
  const line = normalizeLine(raw);
  // A recruiting sentence can still contain a valid years-of-experience constraint.
  if (!line || HEADING.test(line)) return [];
  const atoms = [];
  const years = line.match(/\b\d+\s*(?:[-–—]|to)\s*\d+\s*years?(?:\s+of)?\s+(?:professional\s+)?(?:software|engineering|development|relevant)?\s*experience\b/i)
    || line.match(/\b\d+\+?\s*years?(?:\s+of)?\s+(?:professional\s+)?(?:software|engineering|development|relevant)?\s*experience\b/i);
  if (years) atoms.push(normalizeLine(years[0]));
  const cue = line.match(/\b(?:experience with|experience in|proficiency in|knowledge of|familiarity with|expertise in|understanding of|skills? in)\s+(.+)/i);
  if (cue) atoms.push(...splitList(cue[1].replace(/\b(?:is required|is preferred|is a plus)\b.*$/i, '')));
  else if (!BOILERPLATE.test(line)) atoms.push(...splitList(line.replace(/^(?:required|must(?: have)?|essential|qualifications?|bonus|nice to have|preferred|plus)\s*[:\-]?\s*/i, '').replace(LEADING_CUE, '')));
  return atoms.filter(isMeaningful);
};

const grounded = (candidate, jd) => {
  const key = normalKey(candidate);
  const source = normalKey(jd);
  if (!key || !source) return false;
  return key.split(/\s+/).filter((word) => word.length > 1).every((word) => source.includes(word));
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
    if (REQUIREMENT_SECTION.test(line)) { inRequirementsSection = true; return; }
    if (SECTION_END.test(line)) { inRequirementsSection = false; return; }
    const marker = line.match(REQUIREMENT_MARKER);
    const bonus = line.match(BONUS_MARKER);
    if (!marker && !bonus && !inRequirementsSection && !REQUIREMENT_HINT.test(line)) return;
    const source = normalizeLine((marker || bonus)?.[2] || line);
    atomize(source).forEach((candidate) => {
      const key = semanticKey(candidate);
      if (!grounded(candidate, text) || seen.has(key)) return;
      seen.add(key);
      requirements.push({ id: `r${requirements.length + 1}`, text: candidate, kind: deriveKind(candidate), priority: derivePriority(line, bonus) });
    });
  });
  const responsibilities = lines.filter((line) => /^(responsibilit(?:y|ies)|what you.?ll do|you will)\b/i.test(line)).map((line) => line.replace(/^[^:]+:\s*/i, '')).filter(Boolean);
  return { title, seniority: seniorityMatch ? seniorityMatch[1] : '', location: locationMatch ? locationMatch[1].trim() : '', responsibilities, requirements, jd_chars: text.length };
};

module.exports = { analyzeJobDescription, atomize, grounded, normalKey, semanticKey };
