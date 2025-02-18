const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            return res.redirect('/login.html');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            return res.redirect('/login.html');
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.redirect('/login.html');
    }
};

module.exports = auth; 