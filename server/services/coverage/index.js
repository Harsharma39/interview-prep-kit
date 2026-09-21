const calculateCoverage = (requirements, questions) => {
  const covered = new Set((questions || []).flatMap((question) => question.requirement_ids || []));
  return requirements.filter((requirement) => !covered.has(requirement.id)).map((requirement) => requirement.id);
};

module.exports = { calculateCoverage };