const crypto = require('crypto');
const { analyzeJobDescription } = require('../jd/analyze');
const { researchCompany } = require('../research');
const { calculateCoverage } = require('../coverage');
const { buildSchedule } = require('../scheduler');
const { validateKit } = require('../../schemas/kitSchema');
const { generateWithGemini } = require('../llm');

const stableHash = (jd, companyUrl, days) => crypto.createHash('sha256').update(`${jd.replace(/\s+/g, ' ').trim()}|${companyUrl.trim().replace(/\/$/, '')}|${Number(days)}`).digest('hex');

const questionFor = (requirement, companyName, category) => {
  const promptByCategory = {
    technical: `Walk me through a project where you used ${requirement.text}. What did you personally build and why?`,
    behavioural: `Tell me about a time your work required ${requirement.text}. How did you approach the situation and collaborate?`,
    'system-design': `How would ${requirement.text} influence the design trade-offs you would make for a scalable ${companyName} product?`,
    'company-fit': `Which experience with ${requirement.text} best shows how you would contribute at ${companyName}?`,
  };
  return { requirement_ids: [requirement.id], category, prompt: promptByCategory[category], answer_outline: `Use a concrete example, explain your decisions, and finish with a measurable result relevant to ${requirement.text}.`, difficulty: requirement.priority === 'must' ? 3 : 2 };
};

const createQuestions = (requirements, companyName, categories) => requirements.flatMap((requirement) => {
  const category = requirement.kind === 'behavioural' ? 'behavioural' : 'technical';
  const targets = categories?.length ? categories : [category];
  return targets.map((target) => questionFor(requirement, companyName, target));
}).map((question, index) => ({ ...question, id: `q${index + 1}` }));

const createFlashcards = (requirements) => requirements.map((requirement, index) => ({ id: `f${index + 1}`, front: `How can you evidence: ${requirement.text}?`, back: `Prepare one concise example, the result, and what you learned about ${requirement.text}.`, requirement_ids: [requirement.id] }));

const parseCompanyUrl = (companyUrl) => {
  try {
    return new URL(companyUrl);
  } catch {
    throw new Error('A valid company URL is required.');
  }
};

const companyNameFromUrl = (companyUrl) => {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, '').split('.')[0] || 'the company';
  } catch {
    return 'the company';
  }
};

const QUESTION_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];

const normalizeLlmQuestions = (llmOutput, requirements) => (llmOutput?.questions || []).map((question, index) => ({
  id: `q${index + 1}`,
  requirement_ids: (question.requirement_ids || []).filter((id) => requirements.some((requirement) => requirement.id === id)),
  category: QUESTION_CATEGORIES.includes(question.category) ? question.category : 'technical',
  prompt: String(question.prompt || '').trim(),
  answer_outline: String(question.answer_outline || '').trim(),
  difficulty: [1, 2, 3].includes(Number(question.difficulty)) ? Number(question.difficulty) : 2,
})).filter((question) => question.prompt && question.requirement_ids.length);

const normalizeLlmFlashcards = (llmOutput, requirements) => (llmOutput?.flashcards || []).map((card, index) => ({
  id: `f${index + 1}`,
  front: String(card.front || '').trim(),
  back: String(card.back || '').trim(),
  requirement_ids: (card.requirement_ids || []).filter((id) => requirements.some((requirement) => requirement.id === id)),
})).filter((card) => card.front && card.back && card.requirement_ids.length);

const nextQuestionId = (questions) => {
  let maxId = 0;
  questions.forEach((question) => {
    const match = /^q(\d+)$/.exec(question.id);
    if (match) maxId = Math.max(maxId, Number(match[1]));
  });
  return () => (`q${++maxId}`);
};

const assignQuestionIds = (questions, existing = []) => {
  const allocateId = nextQuestionId([...existing, ...questions]);
  const seen = new Set(existing.map((question) => question.id));
  return questions.map((question) => {
    const id = seen.has(question.id) ? allocateId() : question.id;
    seen.add(id);
    return { ...question, id };
  });
};

const coverRequirements = (questions, requirements) => {
  const uncovered = calculateCoverage(requirements, questions);
  const allocateId = nextQuestionId(questions);
  uncovered.forEach((id) => {
    questions.push({ id: allocateId(), requirement_ids: [id], category: 'technical', prompt: `What is your strongest evidence for requirement ${id}?`, answer_outline: 'Use a concrete situation, action, and measurable result from your experience.', difficulty: 2 });
  });
  return { uncovered, finalUncovered: calculateCoverage(requirements, questions) };
};

const mergeQuestions = (current, additions) => {
  const seen = new Set(current.map((question) => `${question.category}|${question.prompt.trim().toLowerCase()}|${[...question.requirement_ids].sort().join(',')}`));
  const unique = additions.filter((question) => {
    const key = `${question.category}|${question.prompt.trim().toLowerCase()}|${[...question.requirement_ids].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...assignQuestionIds(unique, current)];
};

const runCoveragePasses = async ({ requirements, initialQuestions, generateTargetedQuestions }) => {
  let questions = assignQuestionIds(initialQuestions);
  const uncoveredAfterFirstPass = calculateCoverage(requirements, questions);
  if (!uncoveredAfterFirstPass.length) return { questions, uncovered_requirement_ids: [], passes: 1, secondPassError: null };
  let secondPassError = null;
  try {
    const additions = await generateTargetedQuestions(uncoveredAfterFirstPass);
    questions = mergeQuestions(questions, additions || []);
  } catch (error) {
    secondPassError = error;
  }
  return { questions, uncovered_requirement_ids: calculateCoverage(requirements, questions), passes: 2, secondPassError };
};

const buildKit = ({ companyName, company_url, days, roleAnalysis, research, llmOutput, questions, flashcards, coveragePasses, finalUncovered }) => ({
  source: { company: companyName, company_url, role: roleAnalysis.title, location: roleAnalysis.location, jd_chars: roleAnalysis.jd_chars, researched_at: new Date().toISOString(), pages_used: research.pages_used },
  company_brief: { summary: llmOutput?.company_brief?.summary || `Public information gathered from ${research.pages.length} company page(s). Interview-process reports were not treated as official policy.`, what_they_do: llmOutput?.company_brief?.what_they_do || research.corpus.slice(0, 500), sources: research.pages_used },
  role: { title: roleAnalysis.title, seniority: roleAnalysis.seniority, responsibilities: roleAnalysis.responsibilities, requirements: roleAnalysis.requirements },
  questions,
  flashcards,
  schedule: buildSchedule(questions, roleAnalysis.requirements, days),
  coverage: { uncovered_requirement_ids: finalUncovered, passes: coveragePasses },
});

const generateKit = async ({ jd, company_url, days, onStage = () => {}, questionCategories, allowPrivateResearch = false }) => {
  parseCompanyUrl(company_url);
  const companyName = companyNameFromUrl(company_url);
  await onStage('analyzing');
  const roleAnalysis = analyzeJobDescription(jd);
  await onStage('researching');
  const research = await researchCompany(company_url, { allowPrivateResearch });
  let llmOutput = null;
  try { llmOutput = await generateWithGemini({ role: roleAnalysis, companyName, corpus: research.corpus, interviewProcess: research.interview_process }); } catch (error) { if (process.env.GEMINI_API_KEY) console.warn(`LLM generation unavailable, using deterministic fallback: ${error.message}`); }
  const requestedCategories = Array.isArray(questionCategories) && questionCategories.length ? questionCategories.filter((category) => QUESTION_CATEGORIES.includes(category)) : null;
  let questions = normalizeLlmQuestions(llmOutput, roleAnalysis.requirements).filter((question) => !requestedCategories || requestedCategories.includes(question.category));
  if (!questions.length) questions = createQuestions(roleAnalysis.requirements, companyName, requestedCategories);
  const coverage = await runCoveragePasses({
    requirements: roleAnalysis.requirements,
    initialQuestions: questions,
    generateTargetedQuestions: async (uncoveredIds) => {
      const gaps = roleAnalysis.requirements.filter((requirement) => uncoveredIds.includes(requirement.id));
      const targetedOutput = await generateWithGemini({ role: { ...roleAnalysis, requirements: gaps }, companyName, corpus: research.corpus, interviewProcess: research.interview_process, generationTask: 'Generate only additional questions for these uncovered requirement IDs. Do not repeat covered requirements.' });
      return normalizeLlmQuestions(targetedOutput, gaps);
    },
  });
  questions = coverage.questions;
  // The model-driven second pass is genuine, but a provider outage must not
  // leave a completed kit with uncovered requirements. Fill any residual gaps
  // deterministically and retain the recorded two-pass coverage process.
  let finalUncovered = coverage.uncovered_requirement_ids;
  if (finalUncovered.length) {
    const fallbackCoverage = coverRequirements(questions, roleAnalysis.requirements);
    finalUncovered = fallbackCoverage.finalUncovered;
  }
  const llmFlashcards = normalizeLlmFlashcards(llmOutput, roleAnalysis.requirements);
  const flashcards = llmFlashcards.length ? llmFlashcards : createFlashcards(roleAnalysis.requirements);
  await onStage('validating');
  const kit = buildKit({ companyName, company_url, days, roleAnalysis, research, llmOutput, questions, flashcards, coveragePasses: coverage.passes, finalUncovered });
  const errors = validateKit(kit);
  if (errors.length) throw new Error(`Generated kit failed validation: ${errors.join(' ')}`);
  await onStage('complete');
  return kit;
};

module.exports = { generateKit, stableHash, runCoveragePasses, mergeQuestions, assignQuestionIds, coverRequirements };
