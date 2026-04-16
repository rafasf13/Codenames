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

async function createRoom(movies, solo) {
  const code = generateRoomCode();
  isSoloGame = !!solo;
  const moviesData = {};
  movies.forEach((m, i) => {
    moviesData[i] = { id: m.id, title: m.title, posterPath: m.posterPath || null };
  });

  const data = {
    state: solo ? STATES.SUBMISSION : STATES.WAITING,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    solo: !!solo,
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
  saveActiveGame(code, 'player1', !!solo);
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
  saveActiveGame(code, 'player2', false);
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

async function submitActors(actors) {
  const validActors = actors.filter(a => a && a.id);
  await writeSubmission(currentRoom, mySlot, {
    submitted: true,
    actors: validActors.map(a => ({ id: a.id, name: a.name })),
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
    winner: winner
  };

  // Record scores locally BEFORE setting state to RESULTS,
  // because the Firebase listener will immediately render results
  if (data.daily || isDailyGame) {
    updateBestSoloScore(p1Score, p1Covered.size, p1ActorCount);
    await submitDailyScore(p1Score, p1Covered.size, p1ActorCount);
  } else if (data.solo) {
    updateBestSoloScore(p1Score, p1Covered.size, p1ActorCount);
  } else {
    const myPid = getPlayerId();
    const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const oppPid = data.players[oppSlot].playerId;
    const oppName = data.players[oppSlot].name || 'Opponent';
    const myScore = mySlot === 'player1' ? p1Score : p2Score;
    const oppScore = mySlot === 'player1' ? p2Score : p1Score;
    const myCovered = mySlot === 'player1' ? p1Covered.size : p2Covered.size;
    const oppCoveredCount = mySlot === 'player1' ? p2Covered.size : p1Covered.size;
    recordVsMatch(myPid, oppPid, myScore, oppScore, myCovered, oppCoveredCount, oppName);
  }

  await writeResults(currentRoom, results);
  await setState(currentRoom, STATES.RESULTS);
}

// Score = moviesCovered * (26 - actorsUsed)
function calculateScore(moviesCovered, actorsUsed) {
  if (actorsUsed === 0) return 0;
  return moviesCovered * (26 - actorsUsed);
}

function saveActiveGame(roomCode, slot, solo) {
  localStorage.setItem('cinenames_active_game', JSON.stringify({
    roomCode, slot, solo, timestamp: Date.now()
  }));
}

function clearActiveGame() {
  localStorage.removeItem('cinenames_active_game');
}

function getActiveGame() {
  const stored = localStorage.getItem('cinenames_active_game');
  if (!stored) return null;
  const data = JSON.parse(stored);
  // Expire after 30 minutes
  if (Date.now() - data.timestamp > 30 * 60 * 1000) {
    clearActiveGame();
    return null;
  }
  return data;
}

async function tryRejoinGame() {
  const active = getActiveGame();
  if (!active) return false;

  const data = await readRoom(active.roomCode);
  if (!data) {
    clearActiveGame();
    return false;
  }

  // Only rejoin if game is still in progress
  if (data.state === STATES.RESULTS) {
    clearActiveGame();
    return false;
  }

  // Verify this player is in the room
  const myPid = getPlayerId();
  const slot = active.slot;
  if (!data.players || !data.players[slot] || data.players[slot].playerId !== myPid) {
    clearActiveGame();
    return false;
  }

  currentRoom = active.roomCode;
  mySlot = slot;
  isSoloGame = !!active.solo;

  // Mark as connected again
  await updateRoom(active.roomCode, {
    ['players/' + slot + '/connected']: true
  });

  startListening();
  return true;
}

let isDailyGame = false;
let dailyDate = null;

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
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
  saveActiveGame(code, 'player1', true);
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

async function submitDailyScore(score, covered, actorCount) {
  const dateStr = dailyDate || getTodayStr();
  markDailyPlayed(dateStr);
  await writeDailyScore(dateStr, getPlayerId(), {
    name: getPlayerName(),
    score: score,
    covered: covered,
    actors: actorCount,
    submittedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

let forceFinishing = false;
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
