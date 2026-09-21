const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cookieSameSite = () => {
	const value = String(process.env.COOKIE_SAME_SITE || 'Lax').toLowerCase();
	if (!['lax', 'strict', 'none'].includes(value)) throw new Error('COOKIE_SAME_SITE must be Lax, Strict, or None.');
	return value.charAt(0).toUpperCase() + value.slice(1);
};

const setSessionCookie = (res, token) => {
	const flags = [
		`interview_session=${encodeURIComponent(token)}`,
		'HttpOnly',
		'Path=/',
		`SameSite=${cookieSameSite()}`,
		...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
		`Max-Age=${60 * 60 * 24 * 7}`,
	];
	res.setHeader('Set-Cookie', flags.join('; '));
};

const clearSessionCookie = (res) => {
	const flags = [
		'interview_session=',
		'HttpOnly',
		'Path=/',
		`SameSite=${cookieSameSite()}`,
		...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
		'Max-Age=0',
	];
	res.setHeader('Set-Cookie', flags.join('; '));
};

const issueToken = (user) => jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });

const register = async (req, res, next) => {
	try {
		const email = String(req.body.email || '').trim().toLowerCase();
		const password = String(req.body.password || '');
		if (!emailPattern.test(email) || password.length < 8) {
			return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Use a valid email and a password of at least 8 characters.' } });
		}

		const existing = await User.findOne({ email });
		if (existing) {
			return res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account already exists for this email.' } });
		}

		const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
		setSessionCookie(res, issueToken(user));
		return res.status(201).json({ user: { id: user._id, email: user.email } });
	} catch (error) {
		return next(error);
	}
};

const login = async (req, res, next) => {
	try {
		const email = String(req.body.email || '').trim().toLowerCase();
		const password = String(req.body.password || '');
		const user = await User.findOne({ email }).select('+passwordHash');
		const valid = user && await bcrypt.compare(password, user.passwordHash);
		if (!valid) {
			return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
		}

		setSessionCookie(res, issueToken(user));
		return res.json({ user: { id: user._id, email: user.email } });
	} catch (error) {
		return next(error);
	}
};

const logout = (req, res) => {
	clearSessionCookie(res);
	return res.status(204).send();
};

const me = (req, res) => res.json({ user: { id: req.user._id, email: req.user.email } });

module.exports = { register, login, logout, me, cookieSameSite };
