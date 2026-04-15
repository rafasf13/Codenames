// Player identity and score tracking via localStorage

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
}

function getPlayer() {
  const stored = localStorage.getItem('cinenames_player');
  if (stored) return JSON.parse(stored);
  return null;
}

function savePlayer(player) {
  localStorage.setItem('cinenames_player', JSON.stringify(player));
}

function ensurePlayer(name) {
  let player = getPlayer();
  if (!player) {
    player = {
      id: generatePlayerId(),
      name: name,
      bestSoloScore: 0,
      bestSoloCovered: 0,
      bestSoloActors: 0
    };
  } else {
    player.name = name;
  }
  savePlayer(player);
  return player;
}

function getPlayerName() {
  const p = getPlayer();
  return p ? p.name : null;
}

function getPlayerId() {
  const p = getPlayer();
  return p ? p.id : null;
}

// --- Solo scores (top 20 leaderboard) ---
function getSoloLeaderboard() {
  const stored = localStorage.getItem('cinenames_solo_leaderboard');
  if (stored) return JSON.parse(stored);
  return [];
}

function saveSoloLeaderboard(lb) {
  localStorage.setItem('cinenames_solo_leaderboard', JSON.stringify(lb));
}

function addSoloScore(playerName, score, covered, actors) {
  const lb = getSoloLeaderboard();
  lb.push({
    name: playerName,
    score: score,
    covered: covered,
    actors: actors,
    date: new Date().toISOString().slice(0, 10),
    timestamp: Date.now()
  });
  lb.sort((a, b) => b.score - a.score);
  saveSoloLeaderboard(lb.slice(0, 20));
}

// Keep legacy best score working for lobby display
function updateBestSoloScore(score, covered, actors) {
  const player = getPlayer();
  if (!player) return;
  if (score > (player.bestSoloScore || 0)) {
    player.bestSoloScore = score;
    player.bestSoloCovered = covered;
    player.bestSoloActors = actors;
    savePlayer(player);
  }
  addSoloScore(player.name, score, covered, actors);
}

function getBestSoloScore() {
  const player = getPlayer();
  if (!player) return { score: 0, covered: 0, actors: 0 };
  return {
    score: player.bestSoloScore || 0,
    covered: player.bestSoloCovered || 0,
    actors: player.bestSoloActors || 0
  };
}

// --- VS score tracking ---
function getVsKey(myId, oppId) {
  const sorted = [myId, oppId].sort();
  return 'cinenames_vs_' + sorted[0] + '_' + sorted[1];
}

function getVsScores(myId, oppId) {
  const key = getVsKey(myId, oppId);
  const stored = localStorage.getItem(key);
  if (stored) return JSON.parse(stored);
  return { matches: [] };
}

function saveVsScores(myId, oppId, data) {
  const key = getVsKey(myId, oppId);
  localStorage.setItem(key, JSON.stringify(data));
}

// Store opponent info so we can list them later
function recordVsOpponent(oppId, oppName) {
  const stored = localStorage.getItem('cinenames_vs_opponents');
  const opponents = stored ? JSON.parse(stored) : {};
  opponents[oppId] = oppName;
  localStorage.setItem('cinenames_vs_opponents', JSON.stringify(opponents));
}

function getVsOpponents() {
  const stored = localStorage.getItem('cinenames_vs_opponents');
  return stored ? JSON.parse(stored) : {};
}

function recordVsMatch(myId, oppId, myScore, oppScore, myCovered, oppCovered, oppName) {
  if (oppName) recordVsOpponent(oppId, oppName);
  const data = getVsScores(myId, oppId);
  data.matches.push({
    date: new Date().toISOString().slice(0, 10),
    timestamp: Date.now(),
    scores: { [myId]: myScore, [oppId]: oppScore },
    covered: { [myId]: myCovered || 0, [oppId]: oppCovered || 0 }
  });
  saveVsScores(myId, oppId, data);
}

function getVsTotals(myId, oppId) {
  const data = getVsScores(myId, oppId);
  const today = new Date().toISOString().slice(0, 10);
  let todayMy = 0, todayOpp = 0, allMy = 0, allOpp = 0;
  let wins = 0, losses = 0, draws = 0;
  let totalMyCovered = 0, totalOppCovered = 0;

  data.matches.forEach(m => {
    const ms = m.scores[myId] || 0;
    const os = m.scores[oppId] || 0;
    allMy += ms;
    allOpp += os;
    if (m.date === today) {
      todayMy += ms;
      todayOpp += os;
    }
    if (ms > os) wins++;
    else if (os > ms) losses++;
    else draws++;
    if (m.covered) {
      totalMyCovered += m.covered[myId] || 0;
      totalOppCovered += m.covered[oppId] || 0;
    }
  });

  return {
    matchCount: data.matches.length,
    todayMy, todayOpp, allMy, allOpp,
    wins, losses, draws,
    totalMyCovered, totalOppCovered
  };
}
