let generatedMovies = null;
let pendingMode = null; // 'solo', 'vs', or 'join'

async function init() {
  try {
    await initFirebase();
  } catch (err) {
    console.error('Firebase init failed:', err);
    alert('Failed to connect to server. Check that Anonymous Auth is enabled in Firebase Console.');
    return;
  }
  bindEvents();
  // Check if player has a name already
  if (getPlayerName()) {
    // Try to rejoin an active game first
    const rejoined = await tryRejoinGame();
    if (!rejoined) renderLobby();
  } else {
    renderNamePrompt(() => renderLobby());
  }
}

function bindEvents() {
  // Name change
  document.getElementById('change-name-btn').addEventListener('click', () => {
    renderNamePrompt(() => renderLobby(), true);
  });

  // Lobby — solo
  document.getElementById('solo-btn').addEventListener('click', () => {
    pendingMode = 'solo';
    renderBoardSetup();
  });

  // Lobby — daily puzzle
  document.getElementById('daily-btn').addEventListener('click', async () => {
    const btn = document.getElementById('daily-btn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
      const result = await startDailyPuzzle();
      if (result.alreadyPlayed) {
        const msg = document.getElementById('daily-already-played');
        msg.textContent = "You've already played today's puzzle! Check the leaderboard.";
        msg.style.display = 'block';
        btn.disabled = false;
        btn.textContent = "Play Today's Puzzle";
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load daily puzzle: ' + err.message);
      btn.disabled = false;
      btn.textContent = "Play Today's Puzzle";
    }
  });

  // Lobby — create VS
  document.getElementById('create-room-btn').addEventListener('click', () => {
    pendingMode = 'vs';
    renderBoardSetup();
  });

  // Lobby — join
  document.getElementById('join-room-btn').addEventListener('click', async () => {
    const code = document.getElementById('join-code-input').value;
    if (!code || code.trim().length !== 5) {
      alert('Enter a 5-character room code.');
      return;
    }
    try {
      await joinRoom(code);
    } catch (err) {
      alert(err.message);
    }
  });

  // Board setup — generate
  document.getElementById('generate-board-btn').addEventListener('click', async () => {
    const btn = document.getElementById('generate-board-btn');
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
      const selectedGenres = [...document.querySelectorAll('#genre-checkboxes input:checked')]
        .map(cb => parseInt(cb.value));

      const selectedDecades = [...document.querySelectorAll('#decade-checkboxes input:checked')]
        .map(cb => parseInt(cb.value));

      const selectedLanguages = [...document.querySelectorAll('#language-checkboxes input:checked')]
        .map(cb => cb.value);

      const movies = await discoverMovies(selectedGenres, selectedDecades, selectedLanguages);
      if (movies.length < 25) {
        alert(`Only found ${movies.length} movies. Try broader filters.`);
        btn.disabled = false;
        btn.textContent = 'Generate Board';
        return;
      }
      generatedMovies = movies;
      renderBoardPreview(movies);
    } catch (err) {
      console.error(err);
      alert('Failed to generate board. Try again.');
    }
    btn.disabled = false;
    btn.textContent = 'Generate Board';
  });

  // Board setup — confirm VS
  document.getElementById('confirm-board-btn').addEventListener('click', async () => {
    if (!generatedMovies) return;
    const btn = document.getElementById('confirm-board-btn');
    btn.disabled = true;
    try {
      await createRoom(generatedMovies, false);
    } catch (err) {
      console.error(err);
      alert('Failed to create room.');
      btn.disabled = false;
    }
  });

  // Board setup — confirm Solo
  document.getElementById('confirm-solo-btn').addEventListener('click', async () => {
    if (!generatedMovies) return;
    const btn = document.getElementById('confirm-solo-btn');
    btn.disabled = true;
    try {
      await createRoom(generatedMovies, true);
    } catch (err) {
      console.error(err);
      alert('Failed to start solo game.');
      btn.disabled = false;
    }
  });

  // Leaderboard / Stats
  document.getElementById('solo-scores-btn').addEventListener('click', () => renderSoloLeaderboard());
  document.getElementById('vs-stats-btn').addEventListener('click', () => renderVsStats());
  document.getElementById('daily-lb-btn').addEventListener('click', () => renderDailyLeaderboard());
  document.getElementById('solo-lb-back-btn').addEventListener('click', () => renderLobby());
  document.getElementById('vs-stats-back-btn').addEventListener('click', () => renderLobby());
  document.getElementById('daily-lb-back-btn').addEventListener('click', () => renderLobby());

  // Submission
  document.getElementById('submit-actors-btn').addEventListener('click', () => {
    if (submissionTimer) {
      clearInterval(submissionTimer);
      submissionTimer = null;
    }
    submitActors(selectedActors);
  });

  // Play again
  document.getElementById('play-again-btn').addEventListener('click', () => {
    resetGameState();
    renderLobby();
  });

  // Enter key on join input
  document.getElementById('join-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-room-btn').click();
  });
}

function resetGameState() {
  if (currentRoom) stopListening(currentRoom);
  clearActiveGame();
  currentRoom = null;
  mySlot = null;
  roomData = null;
  generatedMovies = null;
  isSoloGame = false;
  isDailyGame = false;
  dailyDate = null;
  selectedActors = [];
  pendingMode = null;
  forceFinishing = false;
  readyBound = false;
  opponentJoinedBeeped = false;
  if (submissionTimer) {
    clearInterval(submissionTimer);
    submissionTimer = null;
  }
  // Reset board setup UI
  document.getElementById('board-preview').innerHTML = '';
  document.getElementById('confirm-board-btn').style.display = 'none';
  document.getElementById('confirm-solo-btn').style.display = 'none';
  document.getElementById('submission-board').innerHTML = '';
  document.getElementById('actor-fields').innerHTML = '';
}

document.addEventListener('DOMContentLoaded', init);
