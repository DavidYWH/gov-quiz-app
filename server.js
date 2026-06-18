const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

// 兼容 pkg 打包环境：pkg 中 __dirname 指向快照，数据文件需放在 exe 同目录
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(BASE_DIR, 'public')));

// ============ 工具函数 ============
function readJson(filePath, defaultVal = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultVal;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return defaultVal;
    }
}

function writeJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function userDataPath(username, file) {
    // file: 'history' | 'wrong'
    const dir = path.join(BASE_DIR, 'data', 'users', username);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${file}.json`);
}

// ============ 登录 ============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: '请输入账号和密码' });
    }
    const users = readJson(path.join(BASE_DIR, 'data', 'users.json'), []);
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.json({ success: false, error: '账号或密码错误' });
    }
    // 设置登录 Cookie（7天有效）
    res.cookie('username', username, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false });
    res.json({ success: true, username: user.username });
});

// ============ 题库（公开）============
app.get('/api/index', (req, res) => {
    const data = readJson(path.join(BASE_DIR, 'data', 'index.json'), {});
    res.json(data);
});

app.get('/api/questions/:type/:set', (req, res) => {
    const { type, set } = req.params;
    const filePath = path.join(BASE_DIR, 'data', type, `${type}_set${set}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '题目集不存在' });
    }
    res.json(readJson(filePath, []));
});

app.get('/api/question/:type/:number', (req, res) => {
    const { type, number } = req.params;
    const index = readJson(path.join(BASE_DIR, 'data', 'index.json'), {});
    const sets = (index[type] && index[type].sets) || 0;
    for (let i = 1; i <= sets; i++) {
        const filePath = path.join(BASE_DIR, 'data', type, `${type}_set${i}.json`);
        if (fs.existsSync(filePath)) {
            const found = readJson(filePath, []).find(q => q.number == number);
            if (found) return res.json(found);
        }
    }
    res.status(404).json({ error: '题目未找到' });
});

app.get('/api/all-questions/:type', (req, res) => {
    const { type } = req.params;
    const index = readJson(path.join(BASE_DIR, 'data', 'index.json'), {});
    const sets = (index[type] && index[type].sets) || 0;
    let all = [];
    for (let i = 1; i <= sets; i++) {
        const filePath = path.join(BASE_DIR, 'data', type, `${type}_set${i}.json`);
        if (fs.existsSync(filePath)) all = all.concat(readJson(filePath, []));
    }
    res.json(all);
});

// ============ 答题历史（按用户）============
app.post('/api/history', (req, res) => {
    // 支持 username 在 body 或 query 参数中
    const username = req.body.username || req.query.username;
    if (!username) return res.status(400).json({ success: false, error: '未登录' });
    const record = { ...req.body };
    delete record.username;
    const filePath = userDataPath(username, 'history');
    const histories = readJson(filePath, []);
    record.id = Date.now();
    record.date = new Date().toLocaleString('zh-CN');
    histories.push(record);
    writeJson(filePath, histories);
    res.json({ success: true, id: record.id });
});

app.get('/api/history', (req, res) => {
    const { username } = req.query;
    if (!username) return res.json([]);
    const filePath = userDataPath(username, 'history');
    res.json(readJson(filePath, []).reverse());
});

// ============ 错题集（按用户）============
app.post('/api/wrong-questions', (req, res) => {
    // 支持两种格式：
    // 1. { username, wrongs: [...] }
    // 2. query ?username=xxx, body: [...]
    let username = req.query.username;
    let wrongs = req.body;
    if (wrongs && wrongs.username) {
        username = wrongs.username;
        wrongs = wrongs.wrongs || [];
    }
    if (!username) return res.status(400).json({ success: false, error: '未登录' });
    if (!Array.isArray(wrongs)) return res.json({ success: true });

    const filePath = userDataPath(username, 'wrong');
    let existing = readJson(filePath, []);
    for (const w of wrongs) {
        if (!existing.find(e => e.number == w.number && e.type === w.type)) {
            existing.push(w);
        }
    }
    writeJson(filePath, existing);
    res.json({ success: true });
});

app.get('/api/wrong-questions', (req, res) => {
    const { username } = req.query;
    if (!username) return res.json([]);
    const filePath = userDataPath(username, 'wrong');
    res.json(readJson(filePath, []));
});

app.delete('/api/wrong-questions/:number/:type', (req, res) => {
    const { number, type } = req.params;
    const { username } = req.query;
    if (!username) return res.json({ success: true });
    const filePath = userDataPath(username, 'wrong');
    let wrongs = readJson(filePath, []);
    wrongs = wrongs.filter(w => !(w.number == number && w.type === type));
    writeJson(filePath, wrongs);
    res.json({ success: true });
});

// ============ 新增题目（管理功能）============
app.post('/api/questions/add', (req, res) => {
    const { type, question } = req.body;
    if (!['single', 'multi', 'tf'].includes(type)) {
        return res.status(400).json({ error: '题型无效' });
    }
    const indexPath = path.join(BASE_DIR, 'data', 'index.json');
    const index = readJson(indexPath, {});
    const sets = index[type].sets;
    const lastSetPath = path.join(BASE_DIR, 'data', type, `${type}_set${sets}.json`);
    let lastSet = readJson(lastSetPath, []);

    if (lastSet.length >= 100) {
        index[type].sets = sets + 1;
        const newSetPath = path.join(BASE_DIR, 'data', type, `${type}_set${sets + 1}.json`);
        writeJson(newSetPath, [{ id: 1, ...question }]);
    } else {
        const newId = lastSet.length > 0 ? Math.max(...lastSet.map(q => q.id)) + 1 : 1;
        lastSet.push({ id: newId, ...question });
        writeJson(lastSetPath, lastSet);
    }
    index[type].count = index[type].count + 1;
    writeJson(indexPath, index);
    res.json({ success: true });
});

app.post('/api/questions/batch-add', (req, res) => {
    const { type, questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: '题目数据无效' });
    }
    const indexPath = path.join(BASE_DIR, 'data', 'index.json');
    const index = readJson(indexPath, {});
    let sets = index[type].sets;
    let lastSetPath = path.join(BASE_DIR, 'data', type, `${type}_set${sets}.json`);
    let lastSet = readJson(lastSetPath, []);

    let added = 0;
    for (const q of questions) {
        if (lastSet.length >= 100) {
            index[type].sets = index[type].sets + 1;
            sets = index[type].sets;
            const newSetPath = path.join(BASE_DIR, 'data', type, `${type}_set${sets}.json`);
            writeJson(newSetPath, [{ id: 1, ...q }]);
            lastSet = [];
            lastSetPath = newSetPath;
        } else {
            const newId = lastSet.length > 0 ? Math.max(...lastSet.map(q => q.id)) + 1 : 1;
            lastSet.push({ id: newId, ...q });
        }
        added++;
    }
    if (lastSet.length > 0) writeJson(lastSetPath, lastSet);
    index[type].count = index[type].count + added;
    writeJson(indexPath, index);
    res.json({ success: true, added });
});

app.listen(PORT, () => {
    console.log(`答题服务启动成功！访问 http://localhost:${PORT}`);
});
