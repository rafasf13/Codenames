const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATES = {
  LOBBY: 'LOBBY',
  BOARD_SETUP: 'BOARD_SETUP',
  WAITING: 'WAITING',
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
    'state': STATES.SUBMISSION
  });

  currentRoom = code;
  mySlot = 'player2';
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
  const p1ActorCount = p1Results.filter(r => r.actor && r.coveredMovies.length > 0).length;
  const p1Score = calculateScore(p1Covered.size, p1ActorCount);

  let p2Results = [], p2Covered = new Set(), p2ActorCount = 0, p2Score = 0;

  if (!data.solo) {
    const p2Actors = data.submissions.player2.actors || [];
    p2Results = await validateActors(p2Actors, boardMovieIds);
    p2Results.forEach(r => r.coveredMovies.forEach(id => p2Covered.add(id)));
    p2ActorCount = p2Results.filter(r => r.actor && r.coveredMovies.length > 0).length;
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

  await writeResults(currentRoom, results);
  await setState(currentRoom, STATES.RESULTS);

  // Record scores locally
  if (data.solo) {
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
}

// Score = moviesCovered * (26 - actorsUsed)
function calculateScore(moviesCovered, actorsUsed) {
  if (actorsUsed === 0) return 0;
  return moviesCovered * (26 - actorsUsed);
}

function getMovieList() {
  if (!roomData || !roomData.board || !roomData.board.movies) return [];
  return Object.values(roomData.board.movies);
}
