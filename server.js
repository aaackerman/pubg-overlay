/**
 * PUBG Stream Overlay Backend
 * ───────────────────────────
 * Polls the PUBG API every 60s for the configured player's new matches.
 * Fetches telemetry to tally weapons used for kills.
 * Serves the latest processed match to the overlay via GET /latest.
 *
 * Setup:
 *   1. npm install
 *   2. Set PUBG_API_KEY and PLAYER_NAME in .env
 *   3. npm start
 */

require('dotenv').config();

const express  = require('express');
const fetch    = (...args) => import('node-fetch').then(m => m.default(...args));
const cors     = require('cors');
const path     = require('path');

const app  = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// ─── CONFIG ─────────────────────────────
const PUBG_API_KEY   = process.env.PUBG_API_KEY  || 'YOUR_API_KEY_HERE';
const PLAYER_NAME    = process.env.PLAYER_NAME   || 'YOUR_IGN_HERE';
const PLATFORM       = 'steam';           // or 'psn', 'xbox'
const POLL_INTERVAL  = 60 * 1000;         // 60 seconds
const BASE_URL       = `https://api.pubg.com/shards/${PLATFORM}`;
const HEADERS        = {
  'Authorization': `Bearer ${PUBG_API_KEY}`,
  'Accept':        'application/vnd.api+json',
};

// ─── STATE ──────────────────────────────
let latestPayload  = null;
let knownMatchIds  = new Set();
let playerId       = null;
let initialized    = false;

let sessionTotals  = {
  kills: 0, wins: 0, top10s: 0, matches: 0,
  headshots: 0, longestKill: 0,
  zeroKillRun: 0, winStreak: 0,
  weaponTally: {},
};
let squadTotals    = {};   // { playerName: { kills, damage, teamKills } }

// Per-player cache for on-demand lookups (demo/friend mode)
const playerCache       = {};   // { [name]: { playerId, payload, fetchedAt } }
const playerDayTotals   = {};   // { [name]: { totals, squadTotals, building, builtAt } }

// ─── WEAPON NAME MAP ────────────────────
// Keys use the Weap-prefixed internal name (after stripping Item_Weapon_ and _C).
// cleanWeaponName normalizes all raw names to this prefix before lookup.
const WEAPON_MAP = {
  // Assault Rifles
  'WeapHK416':      'M416',
  'WeapAUG':        'AUG A3',
  'WeapSCARL':      'SCAR-L',
  'WeapAK':         'AKM',
  'WeapAKM':        'AKM',
  'WeapG36C':       'G36C',
  'WeapM16A4':      'M16A4',
  'WeapQBZ95':      'QBZ-95',
  'WeapGroza':      'Groza',
  'WeapBerylM762':  'Beryl M762',
  'WeapMk47Mutant': 'Mk47 Mutant',
  'WeapFamas':      'FAMAS',
  'WeapACE32':      'ACE32',
  // DMRs / Snipers
  'WeapAWM':        'AWM',
  'WeapKar98k':     'Kar98k',
  'WeapM24':        'M24',
  'WeapSKS':        'SKS',
  'WeapVSS':        'VSS',
  'WeapMini14':     'Mini 14',
  'WeapQBU88':      'QBU-88',
  'WeapSLR':        'SLR',
  'WeapMk14':       'Mk14 EBR',
  'WeapMk12':       'Mk12',
  'WeapAMR':        'AMR',
  // LMGs
  'WeapDP28':       'DP-28',
  'WeapM249':       'M249',
  'WeapMG3':        'MG3',
  // SMGs
  'WeapUMP':        'UMP45',
  'WeapVector':     'Vector',
  'WeapBizon':      'PP-19 Bizon',
  'WeapThompson':   'Tommy Gun',
  'WeapMP5K':       'MP5K',
  'WeapUZI':        'Micro UZI',
  'WeapP90':        'P90',
  // Shotguns
  'WeapSaiga12':    'S12K',
  'WeapDP12':       'DBS',
  'WeapS1897':      'S1897',
  'WeapS686':       'S686',
  // Pistols
  'WeapP18C':       'P18C',
  'WeapDesertEagle':'Deagle',
  'WeapNagantM1895':'R1895',
  'WeapRhino':      'R45',
  'WeapP92':        'P92',
  // Melee / Special
  'WeapPan':        'Pan',
  'WeapCrossbow':   'Crossbow',
  'WeapM79':        'M79',
};

// ─── HELPERS ────────────────────────────
function cleanWeaponName(raw) {
  if (!raw) return 'Unknown';

  // Strip suffix/prefix added by PUBG
  let stripped = raw
    .replace(/_C$/i, '')
    .replace(/^Item_Weapon_/i, '');

  // Normalize: ensure Weap prefix, strip hyphens for lookup
  const normalized = (stripped.startsWith('Weap') ? stripped : 'Weap' + stripped)
    .replace(/-/g, '');

  if (WEAPON_MAP[normalized]) return WEAPON_MAP[normalized];

  // Fallback: display as-is but strip the Weap prefix and clean separators
  return stripped.replace(/^Weap/i, '').replace(/[_-]/g, ' ').trim() || stripped;
}

// ─── FETCH PLAYER ID ────────────────────
async function fetchPlayerId() {
  const url = `${BASE_URL}/players?filter[playerNames]=${PLAYER_NAME}`;
  const res  = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Player fetch failed: ${res.status}`);
  const json = await res.json();
  return json.data[0].id;
}

// ─── FETCH RECENT MATCHES ────────────────
async function fetchRecentMatchIds() {
  const url = `${BASE_URL}/players/${playerId}`;
  const res  = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Player detail fetch failed: ${res.status}`);
  const json = await res.json();
  return (json.data.relationships.matches.data || []).map(m => m.id);
}

// ─── FETCH MATCH ────────────────────────
async function fetchMatch(matchId) {
  const url = `${BASE_URL}/matches/${matchId}`;
  const res  = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Match fetch failed: ${res.status}`);
  return res.json();
}

// ─── FETCH TELEMETRY ────────────────────
async function fetchTelemetry(telemetryUrl) {
  const res = await fetch(telemetryUrl, {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Telemetry fetch failed: ${res.status}`);
  return res.json();
}

// ─── PARSE TELEMETRY FOR KILL WEAPONS ──────────
// Returns the cleaned weapon name for each kill the player got this match.
function extractKillWeapons(telemetry, playerName) {
  return telemetry
    .filter(e => e._T === 'LogPlayerKillV2' && e.killer?.name === playerName)
    .map(e => cleanWeaponName(e.killerDamageInfo?.damageCauserName || e.finisher?.itemId));
}

// ─── BACKGROUND FULL-DAY ACCUMULATION FOR FRIEND ───
async function buildDayTotalsForPlayer(name, pid) {
  if (playerDayTotals[name]?.building) return;
  playerDayTotals[name] = { building: true, totals: null, squadTotals: null };
  console.log(`Building today's totals for ${name}...`);

  try {
    const today    = new Date().toDateString();
    const detailRes = await fetch(`${BASE_URL}/players/${pid}`, { headers: HEADERS });
    if (!detailRes.ok) throw new Error(`Player detail failed: ${detailRes.status}`);
    const matchIds  = (await detailRes.json()).data.relationships.matches.data.map(m => m.id);

    const todayMatches = [];
    for (const matchId of matchIds) {
      await new Promise(r => setTimeout(r, 6500));
      try {
        const matchJson = await fetchMatch(matchId);
        const createdAt = matchJson.data?.attributes?.createdAt;
        if (!createdAt || new Date(createdAt).toDateString() !== today) break;
        todayMatches.push({ matchId, matchJson });
      } catch (err) { console.error(`Friend init ${matchId}:`, err.message); }
    }

    const totals = {
      kills: 0, wins: 0, top10s: 0, matches: 0,
      headshots: 0, longestKill: 0,
      zeroKillRun: 0, weaponTally: {},
    };
    const squadAcc = {};

    for (const { matchJson } of todayMatches.reverse()) {
      const participants = (matchJson.included || []).filter(i => i.type === 'participant');
      const p = participants.find(p => p.attributes?.stats?.name?.toLowerCase() === name.toLowerCase());
      if (!p) continue;
      const s = p.attributes.stats;
      totals.kills      += s.kills || 0;
      totals.wins       += (s.winPlace === 1)  ? 1 : 0;
      totals.top10s     += (s.winPlace <= 10)  ? 1 : 0;
      totals.matches++;
      totals.headshots  += s.headshotKills || 0;
      if ((s.kills || 0) > 0) totals.zeroKillRun = 0;
      else                    totals.zeroKillRun++;
      if ((s.longestKill || 0) > totals.longestKill) totals.longestKill = s.longestKill || 0;

      // Fetch telemetry for weapon tally (Azure CDN — doesn't count against rate limit)
      try {
        const telAsset = (matchJson.included || []).find(
          i => i.type === 'asset' && i.attributes?.name === 'telemetry'
        );
        if (telAsset) {
          const telemetry = await fetchTelemetry(telAsset.attributes.URL);
          extractKillWeapons(telemetry, name).forEach(w => {
            totals.weaponTally[w] = (totals.weaponTally[w] || 0) + 1;
          });
        }
      } catch (err) { console.error(`Telemetry for ${name} match:`, err.message); }

      // teamKills sourced from per-participant match stats — authoritative
      extractSquadStats(matchJson, p).forEach(({ name: n, kills: k, damage: d, teamKills: tk }) => {
        if (!squadAcc[n]) squadAcc[n] = { kills: 0, damage: 0, teamKills: 0 };
        squadAcc[n].kills     += k;
        squadAcc[n].damage    += d;
        squadAcc[n].teamKills += tk;
      });
    }

    playerDayTotals[name] = { building: false, totals, squadTotals: squadAcc, builtAt: Date.now() };
    console.log(`${name} today: ${totals.kills} kills across ${totals.matches} matches`);

    // Update cached payload so next poll serves full-day data
    if (playerCache[name]) {
      playerCache[name].payload.sessionTotals = totals;
      if (Object.keys(squadAcc).length > 1) playerCache[name].payload.squadTotals = squadAcc;
      playerCache[name].fetchedAt = 0; // expire so next poll refreshes latest match too
    }
  } catch (err) {
    console.error(`buildDayTotalsForPlayer error for ${name}:`, err.message);
    playerDayTotals[name] = { building: false, totals: null, squadTotals: null };
  }
}

// ─── ON-DEMAND FETCH FOR ANY PLAYER ─────
async function fetchLatestForPlayer(name) {
  const cached = playerCache[name];
  // Return cached result if fetched within the last 60s
  if (cached && (Date.now() - cached.fetchedAt) < 60000) {
    return cached.payload;
  }

  // Resolve player ID (cache it)
  let pid = cached?.playerId;
  if (!pid) {
    const url = `${BASE_URL}/players?filter[playerNames]=${encodeURIComponent(name)}`;
    const res  = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Player lookup failed for "${name}": ${res.status}`);
    const json = await res.json();
    if (!json.data?.length) throw new Error(`Player "${name}" not found`);
    pid = json.data[0].id;
  }

  // Fetch most recent match ID
  const detailRes = await fetch(`${BASE_URL}/players/${pid}`, { headers: HEADERS });
  if (!detailRes.ok) throw new Error(`Player detail failed: ${detailRes.status}`);
  const detailJson = await detailRes.json();
  const matchIds   = (detailJson.data.relationships.matches.data || []).map(m => m.id);
  if (!matchIds.length) throw new Error(`No matches found for "${name}"`);

  const matchId   = matchIds[0];
  const matchJson = await fetchMatch(matchId);

  // Find participant
  const participants = (matchJson.included || []).filter(i => i.type === 'participant');
  const participant  = participants.find(p =>
    p.attributes?.stats?.name?.toLowerCase() === name.toLowerCase()
  );
  if (!participant) throw new Error(`Participant not found in match for "${name}"`);

  // Telemetry
  const telAsset = (matchJson.included || []).find(
    i => i.type === 'asset' && i.attributes?.name === 'telemetry'
  );
  let matchWeapons = [];
  if (telAsset) {
    const telemetry = await fetchTelemetry(telAsset.attributes.URL);
    matchWeapons    = extractKillWeapons(telemetry, name);
  }

  // Squad roster — teamKills sourced from per-participant match stats (authoritative)
  const squadMatch = extractSquadStats(matchJson, participant);

  const s = participant.attributes.stats;

  // Build sessionTotals from this single match
  const friendSessionTotals = {
    kills:       s.kills         || 0,
    wins:        (s.winPlace === 1)  ? 1 : 0,
    top10s:      (s.winPlace <= 10)  ? 1 : 0,
    matches:     1,
    headshots:   s.headshotKills || 0,
    longestKill: s.longestKill   || 0,
    zeroKillRun: (s.kills === 0) ? 1 : 0,
    weaponTally: matchWeapons.reduce((acc, w) => { acc[w] = (acc[w] || 0) + 1; return acc; }, {}),
  };

  // Build squad/duo totals from the roster we already extracted above
  const friendSquadTotals = squadMatch.reduce((acc, { name: n, kills: k, damage: d, teamKills: tk }) => {
    acc[n] = { kills: k, damage: d, teamKills: tk };
    return acc;
  }, {});

  const payload = {
    matchId,
    match: { id: matchId, participant: { stats: s } },
    sessionTotals: friendSessionTotals,
    squadTotals:   Object.keys(friendSquadTotals).length > 1 ? friendSquadTotals : null,
    fetchedAt: new Date().toISOString(),
    playerName: name,
  };

  // Start background full-day accumulation on first call
  if (!playerDayTotals[name]?.building && !playerDayTotals[name]?.totals) {
    buildDayTotalsForPlayer(name, pid).catch(() => {});
  }

  // If full-day totals are ready, use them instead of single-match totals
  const dayData = playerDayTotals[name];
  if (dayData?.totals) {
    payload.sessionTotals = dayData.totals;
    if (dayData.squadTotals && Object.keys(dayData.squadTotals).length > 1) {
      payload.squadTotals = dayData.squadTotals;
    }
  }

  playerCache[name] = { playerId: pid, payload, fetchedAt: Date.now() };
  return payload;
}

// ─── FIND PARTICIPANT IN MATCH ──────────
function findParticipant(matchJson) {
  return (matchJson.included || [])
    .filter(i => i.type === 'participant')
    .find(p => p.attributes?.stats?.name?.toLowerCase() === PLAYER_NAME.toLowerCase());
}

// ─── EXTRACT SQUAD STATS FROM MATCH ─────
function extractSquadStats(matchJson, ourParticipant) {
  const included     = matchJson.included || [];
  const participants = included.filter(i => i.type === 'participant');
  const rosters      = included.filter(i => i.type === 'roster');
  const ourRoster    = rosters.find(r =>
    r.relationships?.participants?.data?.some(p => p.id === ourParticipant.id)
  );
  if (!ourRoster) return [];
  const rosterIds = new Set(ourRoster.relationships.participants.data.map(p => p.id));
  return participants
    .filter(p => rosterIds.has(p.id))
    .map(p => ({
      name:      p.attributes.stats.name,
      kills:     p.attributes.stats.kills || 0,
      damage:    Math.round(p.attributes.stats.damageDealt || 0),
      teamKills: p.attributes.stats.teamKills || 0,
    }));
}

// ─── PROCESS ONE MATCH ──────────────────
async function processMatchData(matchId, matchJson) {
  const participant = findParticipant(matchJson);
  if (!participant) { console.log(`Participant not found in ${matchId}`); return; }

  const s         = participant.attributes.stats;
  const kills     = s.kills        || 0;
  const placement = s.winPlace     || 100;
  const headshots = s.headshotKills || 0;
  const longest   = s.longestKill  || 0;

  // Accumulate session totals
  sessionTotals.kills      += kills;
  sessionTotals.wins       += (placement === 1  ? 1 : 0);
  sessionTotals.top10s     += (placement <= 10  ? 1 : 0);
  sessionTotals.matches++;
  sessionTotals.headshots  += headshots;
  if (kills > 0) sessionTotals.zeroKillRun = 0;
  else           sessionTotals.zeroKillRun++;
  if (placement === 1) sessionTotals.winStreak++;
  else                 sessionTotals.winStreak = 0;
  if (longest > sessionTotals.longestKill) sessionTotals.longestKill = longest;

  // Telemetry
  const telAsset = (matchJson.included || []).find(
    i => i.type === 'asset' && i.attributes?.name === 'telemetry'
  );
  if (telAsset) {
    try {
      const telemetry = await fetchTelemetry(telAsset.attributes.URL);
      extractKillWeapons(telemetry, PLAYER_NAME).forEach(w => {
        sessionTotals.weaponTally[w] = (sessionTotals.weaponTally[w] || 0) + 1;
      });
    } catch (err) { console.error('Telemetry error:', err.message); }
  }

  // Squad totals (teamKills sourced from per-participant match stats — authoritative)
  const squadMatch = extractSquadStats(matchJson, participant);
  squadMatch.forEach(({ name, kills: k, damage: d, teamKills: tk }) => {
    if (!squadTotals[name]) squadTotals[name] = { kills: 0, damage: 0, teamKills: 0 };
    squadTotals[name].kills     += k;
    squadTotals[name].damage    += d;
    squadTotals[name].teamKills += tk;
  });
  if (squadMatch.length > 1) {
    console.log('  Squad:', squadMatch.map(p => `${p.name} ${p.kills}k/${p.damage}dmg${p.teamKills ? `/${p.teamKills}TK` : ''}`).join(', '));
    const tks = squadMatch.filter(p => p.teamKills > 0);
    if (tks.length) tks.forEach(p => console.log(`  ⚠️  ${p.name} has ${p.teamKills} team kill(s) this match`));
  }

  latestPayload = {
    matchId,
    match: { id: matchId, participant: { stats: s } },
    sessionTotals: { ...sessionTotals },
    squadTotals:   { ...squadTotals },
    playerName: PLAYER_NAME,
    fetchedAt: new Date().toISOString(),
  };

  console.log(`  Kills: ${kills} | Place: #${placement} | Session: ${sessionTotals.kills}k / ${sessionTotals.matches} matches`);
}

// ─── INITIALIZE FROM TODAY'S MATCHES ────
// On startup, backfill all matches played today so session stats are accurate.
// Spaced at 6.5s apart to stay comfortably under the 10 req/min rate limit.
async function initializeTodayStats() {
  if (initialized) return;
  initialized = true;

  const today    = new Date().toDateString();
  const matchIds = await fetchRecentMatchIds();
  const toProcess = [];

  for (const matchId of matchIds) {
    await new Promise(r => setTimeout(r, 6500));
    try {
      const matchJson  = await fetchMatch(matchId);
      const createdAt  = matchJson.data?.attributes?.createdAt;
      const matchDate  = createdAt ? new Date(createdAt).toDateString() : null;
      if (matchDate !== today) {
        knownMatchIds.add(matchId);
        break; // list is newest-first; everything after this is also old
      }
      toProcess.push({ matchId, matchJson });
      knownMatchIds.add(matchId);
    } catch (err) {
      console.error(`Init: failed to fetch ${matchId}:`, err.message);
    }
  }

  if (!toProcess.length) { console.log('No matches today yet.'); return; }

  console.log(`Found ${toProcess.length} match(es) today — processing oldest first...`);
  for (const { matchId, matchJson } of toProcess.reverse()) {
    console.log(`Processing ${matchId}`);
    await processMatchData(matchId, matchJson);
  }
  console.log(`Init complete: ${sessionTotals.kills} kills across ${sessionTotals.matches} matches today.`);
}

// ─── MAIN POLL ──────────────────────────
async function poll() {
  try {
    if (!playerId) {
      console.log(`Fetching player ID for ${PLAYER_NAME}...`);
      playerId = await fetchPlayerId();
      console.log(`Player ID: ${playerId}`);
    }

    if (!initialized) {
      await initializeTodayStats();
      return;
    }

    const matchIds = await fetchRecentMatchIds();
    const newIds   = matchIds.filter(id => !knownMatchIds.has(id));

    if (!newIds.length) {
      console.log(`[${new Date().toLocaleTimeString()}] No new matches.`);
      return;
    }

    const matchId = newIds[0];
    console.log(`[${new Date().toLocaleTimeString()}] New match: ${matchId}`);
    knownMatchIds.add(matchId);
    const matchJson = await fetchMatch(matchId);

    // Skip matches from previous days
    const createdAt = matchJson.data?.attributes?.createdAt;
    if (createdAt && new Date(createdAt).toDateString() !== new Date().toDateString()) {
      console.log(`Skipping match from ${new Date(createdAt).toDateString()} (not today).`);
      return;
    }

    await processMatchData(matchId, matchJson);

  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

// ─── API ROUTES ─────────────────────────

// Overlay polls this; optional ?player=NAME fetches for a different player on-demand
app.get('/latest', async (req, res) => {
  const playerName = req.query.player;
  if (playerName) {
    try {
      const payload = await fetchLatestForPlayer(playerName);
      return res.json(payload);
    } catch (err) {
      console.error(`On-demand fetch error for "${playerName}":`, err.message);
      return res.status(500).json({ error: err.message });
    }
  }
  if (!latestPayload) return res.json(null);
  res.json(latestPayload);
});

// Health check
app.get('/status', (req, res) => {
  res.json({
    playerName:   PLAYER_NAME,
    playerId:     playerId,
    knownMatches: knownMatchIds.size,
    hasLatest:    !!latestPayload,
    uptime:       process.uptime(),
  });
});

// Lightweight config endpoint — intro scene fetches this to get the player name
app.get('/config', (req, res) => {
  res.json({ playerName: PLAYER_NAME });
});

// ─── START ──────────────────────────────
// Bound to 127.0.0.1 on purpose — overlay is single-user and meant to be
// loaded only by OBS/the browser on the streaming machine. Binding to the
// loopback interface keeps your in-progress match stats off the LAN.
const PORT = 3001;
const HOST = '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`\n🎮 PUBG Overlay Server running on http://${HOST}:${PORT}`);
  console.log(`   Player: ${PLAYER_NAME}`);
  console.log(`   Polling every ${POLL_INTERVAL / 1000}s\n`);
  // Initial poll immediately, then on interval
  poll();
  setInterval(poll, POLL_INTERVAL);
});
