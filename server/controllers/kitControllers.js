const mongoose = require('mongoose');
const crypto = require('crypto');
const Kit = require('../models/Kit');
const { generateKit, stableHash } = require('../services/generation');
const { calculateCoverage } = require('../services/coverage');
const { validateKit } = require('../schemas/kitSchema');
const { mergeGeneratedSection } = require('../services/builder');

const QUESTION_CATEGORIES = new Set(['technical', 'behavioural', 'system-design', 'company-fit']);
const nonEmptyText = (value, maximum = 4000) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;

const runGeneration = async (recordId, generationToken, section = 'all', category) => {
  try {
    const record = await Kit.findOne({ _id: recordId, generationToken });
    if (!record) return;
    await Kit.updateOne({ _id: recordId, generationToken }, { status: 'analyzing', generationStage: 'analyzing' });
    const generated = await generateKit({ jd: record.jd, company_url: record.companyUrl, days: record.days, questionCategories: category ? [category] : undefined, onStage: async (stage) => { await Kit.updateOne({ _id: recordId, generationToken }, { status: stage, generationStage: stage }); } });
    const kit = record.kit ? mergeGeneratedSection(record, generated, section, category) : generated;
    const errors = validateKit(kit);
    if (errors.length) throw new Error(`Generated kit failed validation: ${errors.join(' ')}`);
    await Kit.updateOne({ _id: recordId, generationToken }, { status: 'complete', generationStage: 'complete', kit, error: undefined });
  } catch (error) {
    await Kit.updateOne({ _id: recordId, generationToken }, { status: 'failed', generationStage: 'failed', error: { code: 'GENERATION_FAILED', message: error.message } });
  }
};

const queueGeneration = async (record, section = 'all', category) => {
  const generationToken = crypto.randomUUID();
  record.generationToken = generationToken;
  record.status = 'queued';
  record.generationStage = 'queued';
  record.error = undefined;
  await record.save();
  setImmediate(() => runGeneration(record._id, generationToken, section, category));
};

const createKit = async (req, res, next) => {
  try {
    const { jd, company_url: companyUrl, days } = req.body;
    if (typeof jd !== 'string' || jd.trim().length < 10 || typeof companyUrl !== 'string' || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 30) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide a job description, company URL, and 1-30 available days.' } });
    }
    const inputHash = stableHash(jd, companyUrl, days);
    const existing = await Kit.findOne({ userId: req.user._id, inputHash }).sort({ createdAt: -1 });
    if (existing) return res.status(200).json({ id: existing._id, status: existing.status, generationStage: existing.generationStage });
    const record = await Kit.create({ userId: req.user._id, inputHash, jd, companyUrl, days: Number(days) });
    await queueGeneration(record);
    return res.status(202).json({ id: record._id, status: record.status, generationStage: record.generationStage });
  } catch (error) {
    return next(error);
  }
};

const createBatch = async (req, res, next) => {
  try {
    const roles = req.body.roles;
    if (!Array.isArray(roles) || roles.length < 1 || roles.length > 10) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'roles must contain between 1 and 10 items.' } });
    const results = [];
    for (const role of roles) {
      if (typeof role.jd !== 'string' || typeof role.company_url !== 'string') { results.push({ status: 'failed', error: { code: 'INVALID_INPUT', message: 'Each role requires jd and company_url.' } }); continue; }
      const days = Number(role.days || 5);
      if (role.jd.trim().length < 10 || !Number.isInteger(days) || days < 1 || days > 30) { results.push({ status: 'failed', error: { code: 'INVALID_INPUT', message: 'Each role needs a valid JD and 1-30 days.' } }); continue; }
      const inputHash = stableHash(role.jd, role.company_url, days);
      let record = await Kit.findOne({ userId: req.user._id, inputHash }).sort({ createdAt: -1 });
      if (!record) { record = await Kit.create({ userId: req.user._id, inputHash, jd: role.jd, companyUrl: role.company_url, days }); await queueGeneration(record); }
      results.push({ id: record._id, status: record.status, generationStage: record.generationStage });
    }
    return res.status(202).json({ kits: results });
  } catch (error) { return next(error); }
};

const ownedKit = (req) => (mongoose.Types.ObjectId.isValid(req.params.id) ? Kit.findOne({ _id: req.params.id, userId: req.user._id }) : null);

const listKits = async (req, res, next) => { try { return res.json({ kits: await Kit.find({ userId: req.user._id }).sort({ createdAt: -1 }) }); } catch (error) { return next(error); } };
const getKit = async (req, res, next) => { try { const kit = await ownedKit(req); if (!kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } }); return res.json(kit); } catch (error) { return next(error); } };
const updateKit = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    if (req.body.displayName !== undefined) {
      const displayName = String(req.body.displayName).trim();
      if (displayName.length > 120) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Preparation name must be 120 characters or fewer.' } });
      record.displayName = displayName;
    }
    const hasInputChanges = req.body.jd !== undefined || req.body.company_url !== undefined || req.body.days !== undefined;
    if (hasInputChanges) {
      const jd = String(req.body.jd ?? record.jd).trim();
      const companyUrl = String(req.body.company_url ?? record.companyUrl).trim();
      const days = Number(req.body.days ?? record.days);
      if (jd.length < 10 || !companyUrl || !Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide a valid job description, company URL, and 1-30 days.' } });
      record.jd = jd;
      record.companyUrl = companyUrl;
      record.days = days;
      record.inputHash = stableHash(jd, companyUrl, days);
      record.kit = undefined;
      await queueGeneration(record);
      return res.status(202).json({ id: record._id, status: record.status, generationStage: record.generationStage });
    }
    await record.save();
    return res.json({ id: record._id, displayName: record.displayName });
  } catch (error) { return next(error); }
};
const deleteKit = async (req, res, next) => { try { const result = await Kit.deleteOne({ _id: req.params.id, userId: req.user._id }); if (!result.deletedCount) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } }); return res.status(204).send(); } catch (error) { return next(error); } };

const patchQuestion = async (req, res, next) => {
  try {
    const kitRecord = await ownedKit(req);
    if (!kitRecord?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Completed kit not found.' } });
    const question = kitRecord.kit.questions.find((item) => item.id === req.params.questionId);
    if (!question) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Question not found.' } });
    const { prompt, answer_outline: answerOutline, category, difficulty } = req.body;
    if (prompt !== undefined && !nonEmptyText(prompt)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Question prompt must be non-empty and 4,000 characters or fewer.' } });
    if (answerOutline !== undefined && !nonEmptyText(answerOutline)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Answer outline must be non-empty and 4,000 characters or fewer.' } });
    if (category !== undefined && !QUESTION_CATEGORIES.has(category)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Use a valid question category.' } });
    if (difficulty !== undefined && ![1, 2, 3].includes(Number(difficulty))) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Difficulty must be 1, 2, or 3.' } });
    if (prompt !== undefined) question.prompt = prompt.trim();
    if (answerOutline !== undefined) question.answer_outline = answerOutline.trim();
    if (category !== undefined) question.category = category;
    if (difficulty !== undefined) question.difficulty = Number(difficulty);
    kitRecord.contentState = { ...(kitRecord.contentState || {}), [question.id]: { ...(kitRecord.contentState?.[question.id] || {}), edited: true, pinned: Boolean(req.body.pinned ?? kitRecord.contentState?.[question.id]?.pinned) } };
    kitRecord.markModified('kit');
    kitRecord.markModified('contentState');
    await kitRecord.save();
    return res.json({ question });
  } catch (error) { return next(error); }
};

const addQuestion = async (req, res, next) => {
  try {
    const kitRecord = await ownedKit(req);
    if (!kitRecord?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Completed kit not found.' } });
    const requirementIds = Array.isArray(req.body.requirement_ids) ? req.body.requirement_ids : [];
    const validRequirements = new Set(kitRecord.kit.role.requirements.map((requirement) => requirement.id));
    const category = req.body.category || 'technical';
    const difficulty = Number(req.body.difficulty || 2);
    if (!nonEmptyText(req.body.prompt) || !nonEmptyText(req.body.answer_outline) || !requirementIds.length || !requirementIds.every((id) => validRequirements.has(id)) || !QUESTION_CATEGORIES.has(category) || ![1, 2, 3].includes(difficulty)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide a prompt, answer outline, category, difficulty 1-3, and valid requirement_ids.' } });
    const largestId = kitRecord.kit.questions.reduce((largest, question) => Math.max(largest, Number(/^q(\d+)$/.exec(question.id)?.[1]) || 0), 0);
    const nextId = `q${largestId + 1}`;
    const question = { id: nextId, requirement_ids: requirementIds, category, prompt: req.body.prompt.trim(), answer_outline: req.body.answer_outline.trim(), difficulty };
    kitRecord.kit.questions.push(question);
    kitRecord.contentState = { ...(kitRecord.contentState || {}), [nextId]: { origin: 'manual', edited: true, pinned: true } };
    kitRecord.markModified('kit');
    kitRecord.markModified('contentState');
    await kitRecord.save();
    return res.status(201).json({ question });
  } catch (error) { return next(error); }
};

const deleteQuestion = async (req, res, next) => {
  try {
    const kitRecord = await ownedKit(req);
    if (!kitRecord?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    if (!kitRecord.kit.questions.some((item) => item.id === req.params.questionId)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Question not found.' } });
    kitRecord.kit.questions = kitRecord.kit.questions.filter((item) => item.id !== req.params.questionId);
    kitRecord.kit.schedule.days.forEach((day) => { day.question_ids = day.question_ids.filter((id) => id !== req.params.questionId); });
    delete kitRecord.contentState?.[req.params.questionId];
    kitRecord.kit.coverage.uncovered_requirement_ids = calculateCoverage(kitRecord.kit.role.requirements, kitRecord.kit.questions);
    kitRecord.markModified('kit');
    kitRecord.markModified('contentState');
    await kitRecord.save();
    return res.status(204).send();
  } catch (error) { return next(error); }
};

const patchCompanyBrief = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    if (!record?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Completed kit not found.' } });
    const { summary, what_they_do: whatTheyDo } = req.body;
    if (summary === undefined && whatTheyDo === undefined) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide summary or what_they_do.' } });
    if (summary !== undefined && !nonEmptyText(summary)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Summary must be non-empty and 4,000 characters or fewer.' } });
    if (whatTheyDo !== undefined && !nonEmptyText(whatTheyDo)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'what_they_do must be non-empty and 4,000 characters or fewer.' } });
    if (summary !== undefined) record.kit.company_brief.summary = summary.trim();
    if (whatTheyDo !== undefined) record.kit.company_brief.what_they_do = whatTheyDo.trim();
    record.contentState = { ...(record.contentState || {}), company_brief: { ...(record.contentState?.company_brief || {}), edited: true, pinned: Boolean(req.body.pinned ?? record.contentState?.company_brief?.pinned) } };
    record.markModified('kit');
    record.markModified('contentState');
    await record.save();
    return res.json({ company_brief: record.kit.company_brief });
  } catch (error) { return next(error); }
};

const patchFlashcard = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    if (!record?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Completed kit not found.' } });
    const card = record.kit.flashcards.find((item) => item.id === req.params.flashcardId);
    if (!card) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flashcard not found.' } });
    if (req.body.front !== undefined && !nonEmptyText(req.body.front)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Flashcard front must be non-empty and 4,000 characters or fewer.' } });
    if (req.body.back !== undefined && !nonEmptyText(req.body.back)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Flashcard back must be non-empty and 4,000 characters or fewer.' } });
    if (req.body.front !== undefined) card.front = req.body.front.trim();
    if (req.body.back !== undefined) card.back = req.body.back.trim();
    record.contentState = { ...(record.contentState || {}), [card.id]: { ...(record.contentState?.[card.id] || {}), edited: true, pinned: Boolean(req.body.pinned ?? record.contentState?.[card.id]?.pinned) } };
    record.markModified('kit');
    record.markModified('contentState');
    await record.save();
    return res.json({ flashcard: card });
  } catch (error) { return next(error); }
};

const addFlashcard = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    if (!record?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Completed kit not found.' } });
    const requirementIds = Array.isArray(req.body.requirement_ids) ? req.body.requirement_ids : [];
    const validRequirements = new Set(record.kit.role.requirements.map((requirement) => requirement.id));
    if (!nonEmptyText(req.body.front) || !nonEmptyText(req.body.back) || !requirementIds.length || !requirementIds.every((id) => validRequirements.has(id))) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide a flashcard front, back, and valid requirement_ids.' } });
    const largestId = record.kit.flashcards.reduce((largest, card) => Math.max(largest, Number(/^f(\d+)$/.exec(card.id)?.[1]) || 0), 0);
    const flashcard = { id: `f${largestId + 1}`, front: req.body.front.trim(), back: req.body.back.trim(), requirement_ids: requirementIds };
    record.kit.flashcards.push(flashcard);
    record.contentState = { ...(record.contentState || {}), [flashcard.id]: { origin: 'manual', edited: true, pinned: true } };
    record.markModified('kit');
    record.markModified('contentState');
    await record.save();
    return res.status(201).json({ flashcard });
  } catch (error) { return next(error); }
};

const deleteFlashcard = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    if (!record?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    if (!record.kit.flashcards.some((card) => card.id === req.params.flashcardId)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flashcard not found.' } });
    record.kit.flashcards = record.kit.flashcards.filter((card) => card.id !== req.params.flashcardId);
    delete record.contentState?.[req.params.flashcardId];
    record.markModified('kit');
    record.markModified('contentState');
    await record.save();
    return res.status(204).send();
  } catch (error) { return next(error); }
};

const reorderQuestions = async (req, res, next) => {
  try { const kitRecord = await ownedKit(req); const ids = req.body.question_ids; if (!kitRecord?.kit || !Array.isArray(ids)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'question_ids must be an array.' } }); const byId = new Map(kitRecord.kit.questions.map((question) => [question.id, question])); if (ids.length !== byId.size || ids.some((id) => !byId.has(id))) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Reorder must include each existing question exactly once.' } }); kitRecord.kit.questions = ids.map((id) => byId.get(id)); kitRecord.markModified('kit'); await kitRecord.save(); return res.json({ questions: kitRecord.kit.questions }); } catch (error) { return next(error); }
};

const regenerate = async (req, res, next) => {
  try {
    const record = await ownedKit(req);
    const section = req.body?.section || 'all';
    const category = req.body?.category;
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    if (!['all', 'company_brief', 'questions', 'flashcards', 'schedule'].includes(section)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'section must be all, company_brief, questions, flashcards, or schedule.' } });
    if (category !== undefined && (section !== 'questions' || !QUESTION_CATEGORIES.has(category))) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'A valid question category can only be used when regenerating questions.' } });
    await queueGeneration(record, section, category);
    return res.status(202).json({ id: record._id, status: 'queued', section, category });
  } catch (error) { return next(error); }
};

const resumeQueuedKits = async () => {
  const records = await Kit.find({ status: { $in: ['queued', 'researching', 'analyzing', 'generating', 'validating'] } });
  await Promise.all(records.map((record) => queueGeneration(record)));
  return records.length;
};

module.exports = { createKit, createBatch, listKits, getKit, updateKit, deleteKit, patchQuestion, addQuestion, deleteQuestion, reorderQuestions, patchCompanyBrief, addFlashcard, patchFlashcard, deleteFlashcard, regenerate, resumeQueuedKits };
