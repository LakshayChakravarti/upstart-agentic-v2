const jwt = require('jsonwebtoken');

const INSECURE_DEFAULT = 'upstart-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || INSECURE_DEFAULT;

function validateJwtSecret() {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === INSECURE_DEFAULT) {
        if (process.env.NODE_ENV === 'production') {
            console.error('FATAL: JWT_SECRET is missing or uses insecure default in production. Exiting.');
            process.exit(1);
        }
    }
}

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

module.exports = { authMiddleware, JWT_SECRET, validateJwtSecret };
