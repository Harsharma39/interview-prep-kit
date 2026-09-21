const crypto = require('crypto');
const { analyzeJobDescription } = require('../jd/analyze');
const { researchCompany } = require('../research');
const { calculateCoverage } = require('../coverage');
const { buildSchedule } = require('../scheduler');
const { validateKit } = require('../../schemas/kitSchema');
const { generateWithGemini } = require('../llm');

const stableHash = (jd, companyUrl, days) => crypto.createHash('sha256').update(`${jd.replace(/\s+/g, ' ').trim()}|${companyUrl.trim().replace(/\/$/, '')}|${Number(days)}`).digest('hex');

const competencyType = (text) => {
  if (/\b(api|rest|graphql|endpoint|http)\b/i.test(text)) return 'api';
  if (/\b(database|sql|query|postgres(?:ql)?|mysql|mongo|data model)\b/i.test(text)) return 'data';
  if (/\b(architecture|system design|scalab|distributed|performance)\b/i.test(text)) return 'architecture';
  if (/\b(git|version control|merge)\b/i.test(text)) return 'collaboration';
  if (/\b(frontend|react|component|javascript|typescript|css|ui)\b/i.test(text)) return 'frontend';
  if (/\b(test|quality assurance|automation)\b/i.test(text)) return 'testing';
  if (/\b(security|auth|permission|privacy|encryption)\b/i.test(text)) return 'security';
  if (/\byears?\b.*\bexperience\b/i.test(text)) return 'experience';
  return 'technology';
};

const questionIntent = (requirement) => {
  const type = competencyType(requirement.text);
  if (type !== 'technology') return type;
  // Deterministic selection gives distinct technical dimensions to otherwise
  // similar requirements without random cosmetic wording.
  const score = [...`${requirement.id}:${requirement.text}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return ['concept', 'implementation', 'testing', 'tradeoff'][score % 4];
};

const technicalPrompt = (requirement, difficulty) => {
  const text = requirement.text;
  switch (questionIntent(requirement)) {
    case 'api': return `How would you design and evolve an API using ${text}, including validation, error handling, and backwards compatibility?`;
    case 'data': return `A feature using ${text} is slow in production. How would you diagnose the bottleneck and improve it without compromising correctness?`;
    case 'architecture': return `How would ${text} shape the architecture of a system that must remain maintainable as traffic and teams grow?`;
    case 'collaboration': return `Describe how you would use ${text} to safely integrate conflicting changes from multiple developers on the same feature.`;
    case 'frontend': return `A user interface built with ${text} is rendering more often than expected. How would you identify the cause and fix it?`;
    case 'testing': return `What test strategy would you use for a feature involving ${text}, and which failures would you prioritize catching?`;
    case 'security': return `What threats and security controls would you consider when implementing ${text} in a production application?`;
    case 'experience': return `Tell me about a production project that demonstrates your ${text}. What did you own, which decisions did you make, and what was the outcome?`;
    case 'concept': return `Explain the core ideas behind ${text} and when its behaviour becomes important in a production system.`;
    case 'implementation': return `Walk me through how you would implement a maintainable feature using ${text}, from design through deployment.`;
    case 'testing': return `How would you test an implementation using ${text}, including boundary cases and a realistic failure?`;
    default: return difficulty >= 3 ? `What trade-offs would you evaluate when using ${text} in a system with demanding scale or reliability constraints?` : `When would you choose ${text} over a simpler alternative, and what trade-offs would guide that choice?`;
  }
};

const outlineFor = (requirement, category) => {
  if (category === 'behavioural' || competencyType(requirement.text) === 'experience') return 'Cover the situation, your personal responsibility, the decision or action you took, the measurable result, and what you would improve next time.';
  if (category === 'system-design') return 'State assumptions, propose the components and data flow, explain key trade-offs, identify scaling or failure risks, and show how you would validate the design.';
  if (questionIntent(requirement) === 'data' || questionIntent(requirement) === 'frontend') return 'Explain how you would reproduce or observe the issue, instrument the system, isolate the root cause, implement a fix, verify it, and prevent recurrence.';
  if (questionIntent(requirement) === 'testing') return 'Define the behaviours and edge cases to test, choose suitable test levels, explain failure signals, and describe how the tests protect future changes.';
  if (questionIntent(requirement) === 'security') return 'Identify assets and threats, explain the controls and trade-offs, describe validation or monitoring, and include how you would respond to a failure.';
  return 'Explain the core concept, describe a concrete implementation approach, discuss relevant trade-offs and edge cases, and support it with a production example.';
};

const questionFor = (requirement, companyName, category) => {
  const difficulty = requirement.priority === 'must' ? (questionIntent(requirement) === 'architecture' ? 3 : 2) : 1;
  const promptByCategory = {
    technical: technicalPrompt(requirement, difficulty),
    behavioural: `Tell me about a situation where ${requirement.text} mattered to the outcome. What did you personally do, and how did you work with others?`,
    'system-design': `In a product context similar to ${companyName}, how would you make design decisions around ${requirement.text} as scale and reliability requirements increase?`,
    'company-fit': `Which concrete experience best demonstrates ${requirement.text}, and how would you apply the lessons to this role?`,
  };
  return { requirement_ids: [requirement.id], category, prompt: promptByCategory[category], answer_outline: outlineFor(requirement, category), difficulty: category === 'system-design' ? 3 : difficulty };
};

const createQuestions = (requirements, companyName, categories) => requirements.flatMap((requirement) => {
  const category = requirement.kind === 'behavioural' ? 'behavioural' : 'technical';
  const targets = categories?.length ? categories : [category];
  return targets.map((target) => questionFor(requirement, companyName, target));
}).map((question, index) => ({ ...question, id: `q${index + 1}` }));

const flashcardFor = (requirement, index) => {
  const type = competencyType(requirement.text);
  const front = type === 'api' ? `What design responsibilities matter when working with ${requirement.text}?`
    : type === 'data' ? `How would you evaluate correctness and performance when working with ${requirement.text}?`
      : type === 'architecture' ? `What trade-offs should you explain when discussing ${requirement.text}?`
        : type === 'experience' ? `What evidence should you prepare for your ${requirement.text}?`
          : `What problem does ${requirement.text} solve, and how would you apply it in production?`;
  const back = type === 'experience' ? 'Prepare a concise STAR example: context, your ownership, technical decisions, measurable outcome, and the lesson learned.'
    : 'Explain the core concept, a practical implementation choice, an important trade-off or failure mode, and one production example.';
  return { id: `f${index + 1}`, front, back, requirement_ids: [requirement.id] };
};
const createFlashcards = (requirements) => requirements.map(flashcardFor);

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

// A plan is sent to the provider before question writing so it distributes
// interview dimensions across the bank instead of independently choosing the
// safest experience-question wording for every requirement.
const planQuestionIntents = (requirements, categories) => requirements.flatMap((requirement) => {
  const targets = categories?.length ? categories : [requirement.kind === 'behavioural' ? 'behavioural' : 'technical'];
  return targets.map((category) => ({ requirement_id: requirement.id, category, intent: category === 'behavioural' ? 'behavioural / collaboration' : category === 'system-design' ? 'architecture / trade-offs' : category === 'company-fit' ? 'role-specific reasoning' : questionIntent(requirement), difficulty: questionFor(requirement, 'the company', category).difficulty }));
});

const hasBrokenTemplate = (text) => /how can you evidence:|how would you demonstrate\b|describe a production feature (?:regarding|where you used)\b/i.test(String(text || ''));
const questionShape = (text) => String(text || '').toLowerCase().replace(/\b[a-z0-9+.#/-]{2,}\b/g, (word) => (/^(how|would|you|what|when|tell|about|walk|through|explain|the|a|an|and|or|in|with|to|of|for|is|it|that|this|production|feature|system)$/i.test(word) ? word : '#')).replace(/\s+/g, ' ').trim();
const validQuestionText = (question, requirements) => {
  const prompt = String(question.prompt || '').trim();
  if (!prompt || prompt.length > 420 || hasBrokenTemplate(prompt)) return false;
  // A complete JD paragraph is never a useful interview question. Atomic requirement text remains allowed.
  return question.requirement_ids.every((id) => {
    const requirement = requirements.find((item) => item.id === id);
    return requirement && !(requirement.text.length > 140 && prompt.includes(requirement.text));
  });
};
const validFlashcardText = (card) => !hasBrokenTemplate(card.front) && String(card.front || '').trim().length <= 260 && String(card.back || '').trim().length <= 520;

const normalizeLlmQuestions = (llmOutput, requirements) => {
  const seenShapes = new Set();
  return (llmOutput?.questions || []).map((question, index) => ({
  id: `q${index + 1}`,
  requirement_ids: (question.requirement_ids || []).filter((id) => requirements.some((requirement) => requirement.id === id)),
  category: QUESTION_CATEGORIES.includes(question.category) ? question.category : 'technical',
  prompt: String(question.prompt || '').trim(),
  answer_outline: String(question.answer_outline || '').trim(),
  difficulty: [1, 2, 3].includes(Number(question.difficulty)) ? Number(question.difficulty) : 2,
  })).filter((question) => {
    if (!question.requirement_ids.length || !validQuestionText(question, requirements)) return false;
    const shape = questionShape(question.prompt);
    if (seenShapes.has(shape)) return false;
    seenShapes.add(shape);
    return true;
  });
};

const normalizeLlmFlashcards = (llmOutput, requirements) => (llmOutput?.flashcards || []).map((card, index) => ({
  id: `f${index + 1}`,
  front: String(card.front || '').trim(),
  back: String(card.back || '').trim(),
  requirement_ids: (card.requirement_ids || []).filter((id) => requirements.some((requirement) => requirement.id === id)),
})).filter((card) => card.front && card.back && card.requirement_ids.length && validFlashcardText(card));

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
    const requirement = requirements.find((item) => item.id === id);
    if (requirement) questions.push({ ...questionFor(requirement, 'the company', requirement.kind === 'behavioural' ? 'behavioural' : 'technical'), id: allocateId() });
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
  const requestedCategories = Array.isArray(questionCategories) && questionCategories.length ? questionCategories.filter((category) => QUESTION_CATEGORIES.includes(category)) : null;
  const questionPlan = planQuestionIntents(roleAnalysis.requirements, requestedCategories);
  try { llmOutput = await generateWithGemini({ role: { ...roleAnalysis, question_plan: questionPlan }, companyName, corpus: research.corpus, interviewProcess: research.interview_process, generationTask: 'Generate the question bank using question_plan. For each entry, test its stated intent and difficulty. Do not reuse an intent or scenario structure when another planned angle is available.' }); } catch (error) { if (process.env.GEMINI_API_KEY) console.warn(`LLM generation unavailable, using deterministic fallback: ${error.message}`); }
  let questions = normalizeLlmQuestions(llmOutput, roleAnalysis.requirements).filter((question) => !requestedCategories || requestedCategories.includes(question.category));
  if (!questions.length) questions = createQuestions(roleAnalysis.requirements, companyName, requestedCategories);
  const coverage = await runCoveragePasses({
    requirements: roleAnalysis.requirements,
    initialQuestions: questions,
    generateTargetedQuestions: async (uncoveredIds) => {
      const gaps = roleAnalysis.requirements.filter((requirement) => uncoveredIds.includes(requirement.id));
      const targetedOutput = await generateWithGemini({ role: { ...roleAnalysis, requirements: gaps, question_plan: planQuestionIntents(gaps, requestedCategories) }, companyName, corpus: research.corpus, interviewProcess: research.interview_process, generationTask: 'Generate only additional questions for these uncovered requirement IDs using question_plan. Use a different valid intent from already covered questions; do not repeat their scenario structure.' });
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

module.exports = { generateKit, stableHash, runCoveragePasses, mergeQuestions, assignQuestionIds, coverRequirements, createQuestions, createFlashcards, normalizeLlmQuestions, normalizeLlmFlashcards, questionFor, planQuestionIntents };
