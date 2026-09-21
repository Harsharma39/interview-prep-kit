const Kit = require('../models/Kit');
const PracticeProgress = require('../models/PracticeProgress');

const getOwnedKit = (req) => Kit.findOne({ _id: req.params.id, userId: req.user._id });

const getPractice = async (req, res, next) => {
  try {
    const kit = await getOwnedKit(req);
    if (!kit?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    const progress = await PracticeProgress.findOne({ userId: req.user._id, kitId: kit._id });
    const confidence = progress?.confidence || new Map();
    const cards = [...kit.kit.flashcards].sort((a, b) => (confidence.get(a.id) || 0) - (confidence.get(b.id) || 0));
    return res.json({ cards, confidence: Object.fromEntries(confidence) });
  } catch (error) { return next(error); }
};

const saveConfidence = async (req, res, next) => {
  try {
    const kit = await getOwnedKit(req);
    const value = Number(req.body.confidence);
    if (!kit?.kit || !kit.kit.flashcards.some((card) => card.id === req.body.flashcard_id) || ![1, 2, 3].includes(value)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Use an existing flashcard and confidence 1, 2, or 3.' } });
    const progress = await PracticeProgress.findOneAndUpdate({ userId: req.user._id, kitId: kit._id }, { $set: { [`confidence.${req.body.flashcard_id}`]: value, updatedAt: new Date() } }, { upsert: true, new: true });
    return res.json({ confidence: Object.fromEntries(progress.confidence) });
  } catch (error) { return next(error); }
};

const weakSpots = async (req, res, next) => {
  try {
    const kit = await getOwnedKit(req);
    if (!kit?.kit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kit not found.' } });
    const progress = await PracticeProgress.findOne({ userId: req.user._id, kitId: kit._id });
    const scores = new Map(progress?.confidence || []);
    const areas = kit.kit.role.requirements.map((requirement) => { const cards = kit.kit.flashcards.filter((card) => card.requirement_ids.includes(requirement.id)); const values = cards.map((card) => scores.get(card.id)).filter(Boolean); return { requirement_id: requirement.id, area: requirement.text, confidence: values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / (values.length * 3)) * 100) : 0 }; }).sort((a, b) => a.confidence - b.confidence);
    return res.json({ weak_spots: areas });
  } catch (error) { return next(error); }
};

module.exports = { getPractice, saveConfidence, weakSpots };