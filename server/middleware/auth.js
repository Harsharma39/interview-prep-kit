const jwt = require('jsonwebtoken');
const User = require('../models/User');

const parseCookies = (header = '') => header.split(';').reduce((cookies, item) => {
	const separator = item.indexOf('=');
	if (separator === -1) return cookies;
	const key = item.slice(0, separator).trim();
	cookies[key] = decodeURIComponent(item.slice(separator + 1).trim());
	return cookies;
}, {});

const requireAuth = async (req, res, next) => {
	try {
		const token = parseCookies(req.headers.cookie).interview_session;
		if (!token) {
			return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
		}

		const payload = jwt.verify(token, process.env.JWT_SECRET);
		const user = await User.findById(payload.sub).select('_id email');
		if (!user) {
			return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
		}

		req.user = user;
		return next();
	} catch (error) {
		return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
	}
};

module.exports = { requireAuth, parseCookies };
