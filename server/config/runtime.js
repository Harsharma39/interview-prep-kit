const validateProductionConfiguration = () => {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['JWT_SECRET', 'CLIENT_ORIGIN'];
  if (process.env.SKIP_DB !== 'true') required.push('MONGODB_URI');
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production environment variable(s): ${missing.join(', ')}.`);
};

module.exports = { validateProductionConfiguration };
