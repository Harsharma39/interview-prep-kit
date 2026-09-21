const buckets = new Map();

const cleanup = (now) => {
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= bucket.windowMs) buckets.delete(key);
  }
};

const rateLimit = ({ windowMs = 60_000, max = 30 } = {}) => (req, res, next) => {
  const key = `${req.ip}:${req.method}:${req.originalUrl}`;
  const now = Date.now();
  cleanup(now);
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1, windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > max) {
    const retryAfter = Math.ceil((windowMs - (now - current.startedAt)) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: `Please slow down. Try again in ${retryAfter} seconds.` } });
  }
  return next();
};

module.exports = rateLimit;