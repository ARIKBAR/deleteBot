const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'משתמש קיים במערכת' });
        }

        const user = new User({ email, password });
        await user.save();

        res.status(201).json({ message: 'משתמש נרשם בהצלחה' });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בהרשמה' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'פרטי התחברות שגויים' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'פרטי התחברות שגויים' });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
            expiresIn: '7d'
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({ message: 'התחברת בהצלחה' });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בהתחברות' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'התנתקת בהצלחה' });
});

module.exports = router; 