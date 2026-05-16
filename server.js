const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DEFAULT_CONFIG = { thresholds: [10, 20, 30] };

app.use(express.json());

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';')
      .map(c => c.trim().split('='))
      .filter(p => p.length === 2)
      .map(([k, v]) => [k.trim(), decodeURIComponent(v.trim())])
  );
}

async function requireAuth(req, res, next) {
  const cfg = await readConfig();
  if (!cfg.pin) return next();
  const cookies = parseCookies(req);
  if (cookies.mini_auth === String(cfg.pin)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(express.static(path.join(__dirname, 'public')));

async function readData() {
  const { data, error } = await supabase.from('solves').select('*').order('id');
  if (error) throw error;
  return data;
}

async function readConfig() {
  const { data, error } = await supabase.from('config').select('*').eq('id', 1).single();
  if (error || !data) return DEFAULT_CONFIG;
  return data;
}

async function writeConfig(config) {
  const { error } = await supabase.from('config').upsert({ id: 1, ...config });
  if (error) throw error;
}

async function fetchConstructor(date) {
  const [year, month, day] = date.split('-');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const apiUrl = `https://www.nytimes.com/svc/crosswords/v6/puzzle/mini/${date}.json`;
    const res = await fetch(apiUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      const author = data?.author || data?.results?.[0]?.author;
      if (author) return author.trim();
    }
  } catch {}

  try {
    const pageUrl = `https://www.nytimes.com/crosswords/game/mini/${year}/${month}/${day}`;
    const res = await fetch(pageUrl, { headers });
    const html = await res.text();
    const patterns = [
      /"author"\s*:\s*"([^"]+)"/,
      /"constructor"\s*:\s*"([^"]+)"/,
      /"Constructor"\s*:\s*"([^"]+)"/,
      /by\s+([A-Z][a-zÀ-ÿ\-']+(?: [A-Z][a-zÀ-ÿ\-']+)+)/i,
      /Constructed by ([^<\n]+)/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m && m[1].length < 80) return m[1].trim();
    }
  } catch {}

  return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/auth-required', async (req, res) => {
  const cfg = await readConfig();
  res.json({ required: !!cfg.pin });
});

app.post('/api/login', async (req, res) => {
  const cfg = await readConfig();
  if (!cfg.pin || String(req.body.pin) === String(cfg.pin)) {
    res.setHeader('Set-Cookie', `mini_auth=${cfg.pin}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect PIN' });
  }
});

app.get('/api/solves', async (req, res) => {
  try {
    res.json(await readData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/solves', requireAuth, async (req, res) => {
  const { seconds, date } = req.body;
  if (typeof seconds !== 'number' || seconds <= 0)
    return res.status(400).json({ error: 'Invalid time' });

  const solveDate = date || new Date().toISOString().split('T')[0];
  const constructor = await fetchConstructor(solveDate);
  const entry = { id: Date.now(), seconds, date: solveDate, constructor: constructor || null };

  const { error } = await supabase.from('solves').insert(entry);
  if (error) return res.status(500).json({ error: error.message });
  res.json(entry);
});

app.delete('/api/solves/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supabase.from('solves').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.put('/api/solves/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { seconds } = req.body;
  if (typeof seconds !== 'number' || seconds <= 0)
    return res.status(400).json({ error: 'Invalid time' });
  const { error } = await supabase.from('solves').update({ seconds }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/api/solves/:id/constructor', async (req, res) => {
  const id = Number(req.params.id);
  const { data: solve, error } = await supabase.from('solves').select('*').eq('id', id).single();
  if (error || !solve) return res.status(404).json({ error: 'Not found' });

  const constructor = await fetchConstructor(solve.date);
  const { error: updateError } = await supabase.from('solves').update({ constructor: constructor || null }).eq('id', id);
  if (updateError) return res.status(500).json({ error: updateError.message });
  res.json({ ...solve, constructor: constructor || null });
});

app.get('/api/config', async (req, res) => {
  try {
    res.json(await readConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config', requireAuth, async (req, res) => {
  try {
    const config = { ...DEFAULT_CONFIG, ...req.body };
    await writeConfig(config);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Crossword tracker → http://localhost:${PORT}`));
}

module.exports = app;
