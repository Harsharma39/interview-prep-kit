const allowedKinds = new Set(['technical', 'behavioural', 'domain']);
const allowedPriorities = new Set(['must', 'nice']);
const allowedCategories = new Set(['technical', 'behavioural', 'system-design', 'company-fit']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const validateKit = (kit) => {
  const errors = [];
  if (!kit || typeof kit !== 'object') return ['Kit must be an object.'];
  if (!kit.source || !kit.role || !kit.company_brief || !kit.schedule || !kit.coverage) errors.push('Required kit sections are missing.');

  const requirements = kit.role?.requirements || [];
  const requirementIds = new Set(requirements.map((item) => item.id));
  if (requirementIds.size !== requirements.length) errors.push('Requirement IDs must be unique.');
  requirements.forEach((item) => {
    if (!/^r\d+$/.test(item.id) || !isNonEmptyString(item.text) || !allowedKinds.has(item.kind) || !allowedPriorities.has(item.priority)) {
      errors.push(`Invalid requirement ${item.id || 'without an id'}.`);
    }
  });

  const questionIds = new Set();
  const questionsById = new Map();
  const coveredRequirementIds = new Set();
  (kit.questions || []).forEach((question) => {
    if (questionIds.has(question.id) || !/^q\d+$/.test(question.id)) errors.push(`Invalid or duplicate question ${question.id}.`);
    questionIds.add(question.id);
    if (!allowedCategories.has(question.category) || ![1, 2, 3].includes(question.difficulty) || !isNonEmptyString(question.prompt) || !isNonEmptyString(question.answer_outline)) errors.push(`Invalid question ${question.id}.`);
    if (!Array.isArray(question.requirement_ids) || !question.requirement_ids.length || !question.requirement_ids.every((id) => requirementIds.has(id))) errors.push(`Question ${question.id} references a missing requirement.`);
    question.requirement_ids?.forEach((id) => coveredRequirementIds.add(id));
    questionsById.set(question.id, question);
  });
  requirements.filter((requirement) => requirement.priority === 'must' && !coveredRequirementIds.has(requirement.id)).forEach((requirement) => errors.push(`Must-have requirement ${requirement.id} has no question coverage.`));

  const flashcardIds = new Set();
  (kit.flashcards || []).forEach((card) => {
    if (flashcardIds.has(card.id) || !/^f\d+$/.test(card.id) || !isNonEmptyString(card.front) || !isNonEmptyString(card.back) || !Array.isArray(card.requirement_ids) || !card.requirement_ids.length || !card.requirement_ids.every((id) => requirementIds.has(id))) errors.push(`Invalid flashcard ${card.id}.`);
    flashcardIds.add(card.id);
  });

  const scheduledIds = new Set();
  const scheduledRequirementIds = new Set();
  (kit.schedule.days || []).forEach((day, index) => {
    if (day.day !== index + 1 || !Number.isInteger(day.minutes) || day.minutes < 1 || !day.question_ids?.every((id) => questionIds.has(id))) errors.push(`Invalid schedule day ${day.day}.`);
    day.question_ids?.forEach((id) => {
      scheduledIds.add(id);
      questionsById.get(id)?.requirement_ids?.forEach((requirementId) => scheduledRequirementIds.add(requirementId));
    });
  });
  if (kit.schedule.days.length !== kit.schedule.days_available) errors.push('Schedule day count does not match days_available.');
  requirements.filter((requirement) => requirement.priority === 'must' && !scheduledRequirementIds.has(requirement.id)).forEach((requirement) => errors.push(`Must-have requirement ${requirement.id} is not scheduled.`));
  if (!Array.isArray(kit.coverage?.uncovered_requirement_ids) || !kit.coverage.uncovered_requirement_ids.every((id) => requirementIds.has(id)) || new Set(kit.coverage.uncovered_requirement_ids || []).size !== (kit.coverage.uncovered_requirement_ids || []).length) errors.push('Coverage references invalid or duplicate requirements.');
  if (!Number.isInteger(kit.coverage?.passes) || kit.coverage.passes < 1 || kit.coverage.passes > 2) errors.push('Coverage passes must be 1 or 2.');
  return errors;
};

module.exports = { validateKit };
