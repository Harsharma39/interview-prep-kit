const express = require('express');
const { getPractice, saveConfidence, weakSpots } = require('../controllers/practiceControllers');

const router = express.Router();
router.get('/:id/practice', getPractice);
router.post('/:id/practice/confidence', saveConfidence);
router.get('/:id/weak-spots', weakSpots);
module.exports = router;