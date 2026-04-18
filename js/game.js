const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATES = {
  LOBBY: 'LOBBY',
  BOARD_SETUP: 'BOARD_SETUP',
  WAITING: 'WAITING',
  READY: 'READY',
  SUBMISSION: 'SUBMISSION',
  VALIDATION: 'VALIDATION',
  RESULTS: 'RESULTS'
};

let currentRoom = null;
let mySlot = null; // 'player1' or 'player2'
let roomData = null;
let isSoloGame = false;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

let isBattleGame = false;

async function createRoom(movies, solo, battle) {
  const code = generateRoomCode();
  isSoloGame = !!solo;
  isBattleGame = !!battle;
  const moviesData = {};
  movies.forEach((m, i) => {
    moviesData[i] = { id: m.id, title: m.title, posterPath: m.posterPath || null };
  });

  const data = {
    state: solo ? STATES.SUBMISSION : STATES.WAITING,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    solo: !!solo,
    battle: !!battle,
    board: { movies: moviesData },
    players: {
      player1: {
        uid: getUid(),
        playerId: getPlayerId(),
        name: getPlayerName(),
        joined: true,
        connected: true
      }
    }
  };

  await writeRoom(code, data);
  currentRoom = code;
  mySlot = 'player1';
  saveActiveGame(code, 'player1', !!solo, solo ? 'solo' : (battle ? 'battle' : 'vs'));
  startListening();
  return code;
}

async function joinRoom(code) {
  code = code.toUpperCase().trim();
  const data = await readRoom(code);
  if (!data) throw new Error('Room not found');
  if (data.players && data.players.player2) throw new Error('Room is full');
  if (data.state !== STATES.WAITING) throw new Error('Game already in progress');
  if (data.solo) throw new Error('This is a solo game');

  isSoloGame = false;
  isBattleGame = !!data.battle;

  await updateRoom(code, {
    'players/player2': {
      uid: getUid(),
      playerId: getPlayerId(),
      name: getPlayerName(),
      joined: true,
      connected: true
    },
    'state': STATES.READY
  });

  currentRoom = code;
  mySlot = 'player2';
  saveActiveGame(code, 'player2', false, data.battle ? 'battle' : 'vs');
  startListening();
  return data;
}

function startListening() {
  listenToRoom(currentRoom, (data) => {
    roomData = data;
    if (data) {
      onDisconnectCleanup(currentRoom, mySlot);
      handleStateChange(data);
    }
  });
}

function handleStateChange(data) {
  renderGame(data, mySlot);
}

async function setReady() {
  await updateRoom(currentRoom, {
    ['ready/' + mySlot]: true
  });
}

function bothReady(data) {
  return data.ready && data.ready.player1 && data.ready.player2;
}

async function writeLivePick(index, actor) {
  if (!currentRoom || !mySlot) return;
  const path = `livePicks/${mySlot}/${index}`;
  if (actor) {
    await updateRoom(currentRoom, { [path]: { id: actor.id, name: actor.name } });
  } else {
    await updateRoom(currentRoom, { [path]: null });
  }
}

function getOpponentLivePicks(data) {
  if (!data || !data.livePicks) return [];
  const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
  const picks = data.livePicks[oppSlot];
  if (!picks) return [];
  return Object.values(picks).filter(p => p && p.id);
}

async function submitActors(actors) {
  const validActors = actors.filter(a => a && a.id);
  const timeTaken = SUBMISSION_TIME - submissionTimeLeft;
  await writeSubmission(currentRoom, mySlot, {
    submitted: true,
    actors: validActors.map(a => ({ id: a.id, name: a.name })),
    timeTaken: timeTaken,
    submittedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

function bothSubmitted(data) {
  if (data.solo) {
    return data.submissions && data.submissions.player1 && data.submissions.player1.submitted;
  }
  return data.submissions &&
    data.submissions.player1 && data.submissions.player1.submitted &&
    data.submissions.player2 && data.submissions.player2.submitted;
}

async function runValidation(data) {
  if (validationInProgress) return;
  validationInProgress = true;
  const boardMovies = Object.values(data.board.movies);
  const boardMovieIds = boardMovies.map(m => m.id);

  await setState(currentRoom, STATES.VALIDATION);

  // Fetch top 5 cast for every movie on the board
  const movieCasts = await fetchAllMovieCasts(boardMovieIds);

  const p1Actors = data.submissions.player1.actors || [];
  const p1Results = await validateActors(p1Actors, boardMovieIds);
  const p1Covered = new Set();
  p1Results.forEach(r => r.coveredMovies.forEach(id => p1Covered.add(id)));
  const p1ActorCount = p1Results.filter(r => r.actor).length;
  const p1Score = calculateScore(p1Covered.size, p1ActorCount);

  let p2Results = [], p2Covered = new Set(), p2ActorCount = 0, p2Score = 0;

  if (!data.solo) {
    const p2Actors = data.submissions.player2.actors || [];
    p2Results = await validateActors(p2Actors, boardMovieIds);
    p2Results.forEach(r => r.coveredMovies.forEach(id => p2Covered.add(id)));
    p2ActorCount = p2Results.filter(r => r.actor).length;
    p2Score = calculateScore(p2Covered.size, p2ActorCount);
  }

  let winner = null;
  if (!data.solo) {
    if (p1Score > p2Score) winner = 'player1';
    else if (p2Score > p1Score) winner = 'player2';
  }

  const p1Time = (data.submissions.player1 && data.submissions.player1.timeTaken) || 0;
  const p2Time = (!data.solo && data.submissions.player2 && data.submissions.player2.timeTaken) || 0;

  const results = {
    solo: !!data.solo,
    movieCasts: movieCasts,
    p1Validation: p1Results.map(r => ({ actor: r.actor, coveredMovies: r.coveredMovies })),
    p2Validation: p2Results.map(r => ({ actor: r.actor, coveredMovies: r.coveredMovies })),
    p1CoveredCount: p1Covered.size,
    p2CoveredCount: p2Covered.size,
    p1ActorCount: p1ActorCount,
    p2ActorCount: p2ActorCount,
    p1Score: p1Score,
    p2Score: p2Score,
    p1Time: p1Time,
    p2Time: p2Time,
    winner: winner
  };

  // Record scores locally BEFORE setting state to RESULTS,
  // because the Firebase listener will immediately render results
  if (data.daily || isDailyGame) {
    updateBestSoloScore(p1Score, p1Covered.size, p1ActorCount, p1Time);
    await submitDailyScore(p1Score, p1Covered.size, p1ActorCount, p1Time);
  } else if (data.solo) {
    updateBestSoloScore(p1Score, p1Covered.size, p1ActorCount, p1Time);
  } else {
    const myPid = getPlayerId();
    const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const oppPid = data.players[oppSlot].playerId;
    const oppName = data.players[oppSlot].name || 'Opponent';
    const myScore = mySlot === 'player1' ? p1Score : p2Score;
    const oppScore = mySlot === 'player1' ? p2Score : p1Score;
    const myCovered = mySlot === 'player1' ? p1Covered.size : p2Covered.size;
    const oppCoveredCount = mySlot === 'player1' ? p2Covered.size : p1Covered.size;
    const myTime = mySlot === 'player1' ? p1Time : p2Time;
    const oppTime = mySlot === 'player1' ? p2Time : p1Time;
    recordVsMatch(myPid, oppPid, myScore, oppScore, myCovered, oppCoveredCount, oppName, myTime, oppTime);
  }

  await writeResults(currentRoom, results);
  await setState(currentRoom, STATES.RESULTS);

  // Auto-sync if account is linked
  if (isEmailLinked()) {
    syncStatsToCloud().catch(e => console.error('Auto-sync failed:', e));
  }
}

// Score = moviesCovered * (26 - actorsUsed)
function calculateScore(moviesCovered, actorsUsed) {
  if (actorsUsed === 0) return 0;
  return moviesCovered * (26 - actorsUsed);
}

function saveActiveGame(roomCode, slot, solo, type) {
  localStorage.setItem('cinenames_active_game', JSON.stringify({
    roomCode, slot, solo, timestamp: Date.now()
  }));
  addToGameHistory(roomCode, slot, type || (solo ? 'solo' : 'vs'));
}

function clearActiveGame() {
  localStorage.removeItem('cinenames_active_game');
}

// --- Game history (Recent Games) ---

function addToGameHistory(roomCode, slot, type) {
  const all = JSON.parse(localStorage.getItem('cinenames_game_history') || '[]');
  const existing = all.findIndex(g => g.roomCode === roomCode);
  const entry = {
    roomCode,
    slot,
    type: type || 'vs',
    startedAt: existing >= 0 ? all[existing].startedAt : Date.now(),
    opponentName: existing >= 0 ? all[existing].opponentName : null
  };
  if (existing >= 0) all[existing] = entry;
  else all.unshift(entry);
  localStorage.setItem('cinenames_game_history', JSON.stringify(all.slice(0, 10)));
}

function updateGameHistoryEntry(roomCode, updates) {
  const all = JSON.parse(localStorage.getItem('cinenames_game_history') || '[]');
  const idx = all.findIndex(g => g.roomCode === roomCode);
  if (idx >= 0) {
    Object.assign(all[idx], updates);
    localStorage.setItem('cinenames_game_history', JSON.stringify(all));
  }
}

function getGameHistory() {
  const stored = localStorage.getItem('cinenames_game_history');
  if (!stored) return [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return JSON.parse(stored).filter(g => g.startedAt > cutoff);
}

function removeFromGameHistory(roomCode) {
  const all = JSON.parse(localStorage.getItem('cinenames_game_history') || '[]');
  localStorage.setItem('cinenames_game_history', JSON.stringify(all.filter(g => g.roomCode !== roomCode)));
}

async function rejoinFromHistory(entry) {
  const data = await readRoom(entry.roomCode);
  if (!data) {
    removeFromGameHistory(entry.roomCode);
    return { error: 'expired' };
  }

  const myPid = getPlayerId();
  const slot = entry.slot;
  if (data.players && data.players[slot] && data.players[slot].playerId !== myPid) {
    removeFromGameHistory(entry.roomCode);
    return { error: 'not_in_room' };
  }

  currentRoom = entry.roomCode;
  mySlot = slot;
  isSoloGame = entry.type === 'solo' || entry.type === 'daily';
  isBattleGame = entry.type === 'battle';
  isDailyGame = entry.type === 'daily';

  if (!isSoloGame && data.players && data.players[slot]) {
    await updateRoom(entry.roomCode, { ['players/' + slot + '/connected']: true });
  }

  startListening();
  return { success: true, state: data.state };
}

let isDailyGame = false;
let dailyDate = null;

function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasDailyBeenPlayed(dateStr) {
  const stored = localStorage.getItem('cinenames_daily_played');
  const played = stored ? JSON.parse(stored) : {};
  return !!played[dateStr];
}

function markDailyPlayed(dateStr) {
  const stored = localStorage.getItem('cinenames_daily_played');
  const played = stored ? JSON.parse(stored) : {};
  played[dateStr] = true;
  localStorage.setItem('cinenames_daily_played', JSON.stringify(played));
}

// Seeded random number generator for deterministic daily boards
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = ((s << 5) - s) + seed.charCodeAt(i);
    s |= 0;
  }
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function startDailyPuzzle() {
  const dateStr = getTodayStr();

  if (hasDailyBeenPlayed(dateStr)) {
    return { alreadyPlayed: true, dateStr };
  }

  dailyDate = dateStr;
  isDailyGame = true;
  isSoloGame = true;

  // Check if today's board already exists in Firebase
  let daily = await readDaily(dateStr);

  if (!daily || !daily.board) {
    // Generate a deterministic board from the date seed
    const movies = await generateDailyBoard(dateStr);
    if (movies.length < 25) {
      throw new Error(`Only found ${movies.length} movies for daily puzzle.`);
    }
    const moviesData = {};
    movies.forEach((m, i) => {
      moviesData[i] = { id: m.id, title: m.title, posterPath: m.posterPath || null };
    });
    await writeDailyBoard(dateStr, moviesData);
    daily = await readDaily(dateStr);
  }

  // Each player gets their own room for the daily puzzle
  // The board is shared via daily/{date}/board, but gameplay is isolated
  const playerId = getPlayerId();
  const code = 'DAILY-' + dateStr + '-' + playerId.slice(0, 8);
  const data = {
    state: STATES.SUBMISSION,
    solo: true,
    daily: true,
    board: daily.board,
    players: {
      player1: {
        uid: getUid(),
        playerId: playerId,
        name: getPlayerName(),
        joined: true,
        connected: true
      }
    }
  };

  await writeRoom(code, data);
  currentRoom = code;
  mySlot = 'player1';
  saveActiveGame(code, 'player1', true, 'daily');
  startListening();
  return { alreadyPlayed: false, dateStr };
}

async function generateDailyBoard(dateStr) {
  // Fetch popular movies and use seeded shuffle to pick 25
  const rng = seededRandom('cinenames-daily-' + dateStr);
  const allMovies = [];
  const seenIds = new Set();

  // Fetch several pages of popular movies (no filters for daily)
  // Use seeded page selection for determinism
  const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const page of pages) {
    const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=popularity.desc&vote_count.gte=200&page=${page}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.results) {
      data.results.forEach(m => {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMovies.push(m);
        }
      });
    }
  }

  // Seeded shuffle
  for (let i = allMovies.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allMovies[i], allMovies[j]] = [allMovies[j], allMovies[i]];
  }

  // Deduplicate similar titles
  const deduped = deduplicateSimilarTitles(allMovies);

  return deduped.slice(0, 25).map(m => ({
    id: m.id,
    title: m.title,
    posterPath: m.poster_path,
    releaseDate: m.release_date,
    overview: m.overview
  }));
}

async function submitDailyScore(score, covered, actorCount, timeTaken) {
  const dateStr = dailyDate || getTodayStr();
  markDailyPlayed(dateStr);
  await writeDailyScore(dateStr, getPlayerId(), {
    name: getPlayerName(),
    score: score,
    covered: covered,
    actors: actorCount,
    time: timeTaken || 0,
    submittedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

let forceFinishing = false;
let validationInProgress = false;
async function forceFinishGame(data) {
  if (forceFinishing) return;
  forceFinishing = true;
  try {
    // If opponent hasn't submitted, create an empty submission for them
    const otherSlot = mySlot === 'player1' ? 'player2' : 'player1';
    if (!data.submissions || !data.submissions[otherSlot] || !data.submissions[otherSlot].submitted) {
      await writeSubmission(currentRoom, otherSlot, {
        submitted: true,
        actors: [],
        submittedAt: firebase.database.ServerValue.TIMESTAMP,
        timedOut: true
      });
    }
    // Re-read room data and validate
    const freshData = await readRoom(currentRoom);
    if (freshData && freshData.state === STATES.SUBMISSION) {
      runValidation(freshData);
    }
  } finally {
    forceFinishing = false;
  }
}

function getMovieList() {
  if (!roomData || !roomData.board || !roomData.board.movies) return [];
  return Object.values(roomData.board.movies);
}
