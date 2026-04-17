const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'leaderboard.json');

app.set('trust proxy', true);
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname)));

function ensureDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, '[]\n', 'utf8');
    }
}

function readLeaderboard() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
        return [];
    }
}

async function writeLeaderboard(entries) {
    await fsp.writeFile(DATA_FILE, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

function normalizeName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 32);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = '';

    if (Array.isArray(forwarded) && forwarded.length > 0) {
        ip = forwarded[0];
    } else if (typeof forwarded === 'string' && forwarded.length > 0) {
        ip = forwarded.split(',')[0].trim();
    } else {
        ip = req.ip || req.socket?.remoteAddress || 'unknown';
    }

    if (typeof ip === 'string' && ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }

    return ip || 'unknown';
}

function sortLeaderboard(entries) {
    return [...entries].sort((a, b) => {
        if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
        if (b.bestWorld !== a.bestWorld) return b.bestWorld - a.bestWorld;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

function publicLeaderboard(entries) {
    return sortLeaderboard(entries).slice(0, 20).map((entry, index) => ({
        rank: index + 1,
        name: entry.name,
        ip: entry.ip,
        bestScore: entry.bestScore,
        bestWorld: entry.bestWorld,
        gamesPlayed: entry.gamesPlayed,
        updatedAt: entry.updatedAt,
    }));
}

function upsertPlayer(entries, name, ip) {
    const now = new Date().toISOString();
    let entry = entries.find(item => item.name === name && item.ip === ip);

    if (!entry) {
        entry = {
            name,
            ip,
            bestScore: 0,
            lastScore: 0,
            bestWorld: 1,
            lastWorld: 1,
            gamesPlayed: 0,
            lastOutcome: 'registered',
            createdAt: now,
            updatedAt: now,
        };
        entries.push(entry);
    }

    entry.updatedAt = now;
    return entry;
}

app.get('/api/leaderboard', (req, res) => {
    const entries = readLeaderboard();
    res.json({
        currentIp: getClientIp(req),
        leaderboard: publicLeaderboard(entries),
    });
});

app.post('/api/player', async (req, res) => {
    const name = normalizeName(req.body?.name);
    if (!name) {
        return res.status(400).json({ error: 'Name is required.' });
    }

    const ip = getClientIp(req);
    const entries = readLeaderboard();
    const player = upsertPlayer(entries, name, ip);
    await writeLeaderboard(entries);

    res.json({
        currentIp: ip,
        player: {
            name: player.name,
            ip: player.ip,
            bestScore: player.bestScore,
            bestWorld: player.bestWorld,
        },
        leaderboard: publicLeaderboard(entries),
    });
});

app.post('/api/leaderboard', async (req, res) => {
    const name = normalizeName(req.body?.name);
    const rawScore = Number(req.body?.score);
    const rawWorld = Number(req.body?.world);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.floor(rawScore)) : NaN;
    const world = Number.isFinite(rawWorld) ? Math.max(1, Math.floor(rawWorld)) : 1;
    const outcome = String(req.body?.outcome || 'finished').slice(0, 32);

    if (!name || !Number.isFinite(score)) {
        return res.status(400).json({ error: 'Valid name and score are required.' });
    }

    const ip = getClientIp(req);
    const now = new Date().toISOString();
    const entries = readLeaderboard();
    const player = upsertPlayer(entries, name, ip);

    player.gamesPlayed += 1;
    player.lastScore = score;
    player.lastWorld = world;
    player.lastOutcome = outcome;
    player.updatedAt = now;

    if (score > player.bestScore || (score === player.bestScore && world > player.bestWorld)) {
        player.bestScore = score;
        player.bestWorld = world;
    }

    await writeLeaderboard(entries);

    res.json({
        currentIp: ip,
        player: {
            name: player.name,
            ip: player.ip,
            bestScore: player.bestScore,
            bestWorld: player.bestWorld,
            gamesPlayed: player.gamesPlayed,
        },
        leaderboard: publicLeaderboard(entries),
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Face Mario running → http://localhost:${PORT}`);
});
