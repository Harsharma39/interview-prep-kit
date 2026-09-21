const buildSchedule = (questions, requirements, daysAvailable) => {
  const days = Math.max(1, Math.min(30, Math.floor(Number(daysAvailable) || 1)));
  const priority = new Map(requirements.map((requirement) => [requirement.id, requirement.priority === 'must' ? 0 : 1]));
  const ordered = [...questions].sort((a, b) => {
    const aPriority = Math.min(...a.requirement_ids.map((id) => priority.get(id) ?? 1));
    const bPriority = Math.min(...b.requirement_ids.map((id) => priority.get(id) ?? 1));
    return aPriority - bPriority || b.difficulty - a.difficulty || a.id.localeCompare(b.id);
  });
  const buckets = Array.from({ length: days }, (_, index) => ({ day: index + 1, focus: index === 0 ? 'Core requirements' : 'Practice and review', question_ids: [], minutes: 30 }));
  ordered.forEach((question, index) => buckets[index % days].question_ids.push(question.id));
  buckets.forEach((day, index) => { day.focus = day.question_ids.length ? (index === 0 ? 'Priority requirements' : `Review and practice day ${day.day}`) : 'Consolidate notes'; day.minutes = Math.max(30, day.question_ids.length * 15); });
  return { days_available: days, days: buckets };
};

module.exports = { buildSchedule };