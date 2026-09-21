const express = require('express');
const controllers = require('../controllers/kitControllers');

const router = express.Router();
router.post('/', controllers.createKit);
router.post('/batch', controllers.createBatch);
router.get('/', controllers.listKits);
router.get('/:id', controllers.getKit);
router.patch('/:id', controllers.updateKit);
router.delete('/:id', controllers.deleteKit);
router.post('/:id/regenerate', controllers.regenerate);
router.patch('/:id/company-brief', controllers.patchCompanyBrief);
router.post('/:id/questions', controllers.addQuestion);
router.patch('/:id/questions/:questionId', controllers.patchQuestion);
router.delete('/:id/questions/:questionId', controllers.deleteQuestion);
router.post('/:id/questions/reorder', controllers.reorderQuestions);
router.post('/:id/flashcards', controllers.addFlashcard);
router.patch('/:id/flashcards/:flashcardId', controllers.patchFlashcard);
router.delete('/:id/flashcards/:flashcardId', controllers.deleteFlashcard);

module.exports = router;
