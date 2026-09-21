const { calculateCoverage } = require('../coverage');
const { buildSchedule } = require('../scheduler');

const protectedContent = (state, id) => state?.[id]?.origin === 'manual' || state?.[id]?.edited || state?.[id]?.pinned;
const nextId = (items, prefix) => {
  const largest = items.reduce((max, item) => Math.max(max, Number(new RegExp(`^${prefix}(\\d+)$`).exec(item.id)?.[1]) || 0), 0);
  let current = largest + 1;
  return () => `${prefix}${current++}`;
};

const mergeQuestions = (current, generated, state, category) => {
  const untouched = category ? current.filter((question) => question.category !== category) : [];
  const protectedQuestions = current.filter((question) => (!category || question.category === category) && protectedContent(state, question.id));
  const protectedIds = new Set(protectedQuestions.map((question) => question.id));
  const allocateId = nextId([...untouched, ...protectedQuestions], 'q');
  const replacement = generated
    .filter((question) => !category || question.category === category)
    .filter((question) => !protectedIds.has(question.id))
    .map((question) => ({ ...question, id: allocateId() }));
  return [...untouched, ...protectedQuestions, ...replacement];
};

const mergeFlashcards = (current, generated, state) => {
  const protectedCards = current.filter((card) => protectedContent(state, card.id));
  const protectedIds = new Set(protectedCards.map((card) => card.id));
  const allocateId = nextId(protectedCards, 'f');
  const replacement = generated
    .filter((card) => !protectedIds.has(card.id))
    .map((card) => ({ ...card, id: allocateId() }));
  return [...protectedCards, ...replacement];
};

const mergeGeneratedSection = (record, generated, section, category) => {
  const current = structuredClone(record.kit);
  const state = record.contentState || {};
  if (section === 'company_brief') {
    current.source = generated.source;
    if (!protectedContent(state, 'company_brief')) current.company_brief = generated.company_brief;
    return current;
  }
  if (section === 'schedule') {
    current.schedule = buildSchedule(current.questions, current.role.requirements, record.days);
    return current;
  }
  if (section === 'flashcards') {
    current.flashcards = mergeFlashcards(current.flashcards, generated.flashcards, state);
    return current;
  }
  if (section === 'questions') {
    current.questions = mergeQuestions(current.questions, generated.questions, state, category);
    current.coverage = {
      uncovered_requirement_ids: calculateCoverage(current.role.requirements, current.questions),
      passes: Math.max(1, generated.coverage.passes),
    };
    current.schedule = buildSchedule(current.questions, current.role.requirements, record.days);
    return current;
  }
  current.questions = mergeQuestions(current.questions, generated.questions, state);
  current.flashcards = mergeFlashcards(current.flashcards, generated.flashcards, state);
  if (!protectedContent(state, 'company_brief')) current.company_brief = generated.company_brief;
  current.source = generated.source;
  current.coverage = {
    uncovered_requirement_ids: calculateCoverage(current.role.requirements, current.questions),
    passes: Math.max(1, generated.coverage.passes),
  };
  current.schedule = buildSchedule(current.questions, current.role.requirements, record.days);
  return current;
};

module.exports = { mergeGeneratedSection, protectedContent };
