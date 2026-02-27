const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'video-planner-secret-key-2026';
const JWT_EXPIRES = '7d';

// Ensure data dir
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ============ HELPERS ============
function readUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[auth] Error reading users:', e.message);
    }
    return [];
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// ============ AUTH FUNCTIONS ============

// Register new user (admin only)
async function registerUser(username, password, name, role = 'editor') {
    const users = readUsers();

    if (users.find(u => u.username === username)) {
        throw new Error('Username đã tồn tại');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = {
        id: 'user_' + Date.now().toString(36),
        username,
        passwordHash,
        name: name || username,
        role,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    writeUsers(users);

    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
}

// Login
async function loginUser(username, password) {
    const users = readUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
        throw new Error('Sai tài khoản hoặc mật khẩu');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
        throw new Error('Sai tài khoản hoặc mật khẩu');
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );

    return {
        token,
        user: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        }
    };
}

// Verify JWT middleware
function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token hết hạn, đăng nhập lại' });
    }
}

// Optional auth (don't block, just attach user if token present)
function optionalAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (token) {
        try {
            req.user = jwt.verify(token, JWT_SECRET);
        } catch (e) { /* ignore */ }
    }
    next();
}

// Get all users (admin only, no passwords)
function getUsers() {
    return readUsers().map(({ passwordHash, ...u }) => u);
}

// Delete user
function deleteUser(userId) {
    const users = readUsers();
    const filtered = users.filter(u => u.id !== userId);
    if (filtered.length === users.length) throw new Error('User not found');
    writeUsers(filtered);
}

// Create default admin if no users exist
async function ensureAdmin() {
    const users = readUsers();
    if (users.length === 0) {
        await registerUser('admin', 'admin123', 'Admin', 'admin');
        console.log('✅ Default admin created: admin / admin123');
    }
}

module.exports = {
    registerUser,
    loginUser,
    authMiddleware,
    optionalAuth,
    getUsers,
    deleteUser,
    ensureAdmin
};
