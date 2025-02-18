const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.cookies?.token;
        if (!token) {
            console.warn('Auth Warning: No token provided');
            return handleAuthFailure(req, res);
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error('Auth Error: Invalid or expired token:', error.message);
            return handleAuthFailure(req, res);
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            console.error('Auth Error: User not found');
            return handleAuthFailure(req, res);
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Unexpected Auth Middleware Error:', error);
        return handleAuthFailure(req, res);
    }
};

const handleAuthFailure = (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login.html');
};

module.exports = auth;
