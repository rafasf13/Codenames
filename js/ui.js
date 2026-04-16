let debounceTimer = null;
let selectedActors = [];
let submissionTimer = null;
let submissionTimeLeft = 0;
const SUBMISSION_TIME = 300; // 5 minutes
const MAX_ACTORS = 25;
let activeDropdown = null; // track which dropdown is active for keyboard nav
let highlightedIndex = -1;
let vsMatchRecorded = false;

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

function renderGame(data, mySlot) {
  if (!data) return;
  switch (data.state) {
    case STATES.WAITING:
      if (mySlot === 'player1') renderWaiting(data);
      break;
    case STATES.READY:
      renderReady(data, mySlot);
      break;
    case STATES.SUBMISSION:
      renderSubmission(data, mySlot);
      break;
    case STATES.VALIDATION:
      renderValidation(data);
      break;
    case STATES.RESULTS:
      renderResults(data, mySlot);
      break;
  }
}

// --- Name prompt ---
function renderNamePrompt(callback, forceShow) {
  const existing = getPlayerName();
  if (existing && !forceShow) {
    callback();
    return;
  }
  showScreen('name-prompt');
  const btn = document.getElementById('save-name-btn');
  const input = document.getElementById('player-name-input');
  input.value = existing || '';
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    ensurePlayer(name);
    document.getElementById('player-display-name').textContent = name;
    callback();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') newBtn.click();
  });
  input.focus();
}

// --- Lobby ---
function renderLobby() {
  showScreen('lobby');
  const name = getPlayerName();
  const nameEl = document.getElementById('player-display-name');
  if (nameEl) nameEl.textContent = name || '';
  const best = getBestSoloScore();
  const bestEl = document.getElementById('best-solo-display');
  if (bestEl) {
    bestEl.textContent = best.score > 0
      ? `Best solo: ${best.score} pts (${best.covered} movies, ${best.actors} actors)`
      : '';
  }
  // Update daily puzzle button state
  const dailyMsg = document.getElementById('daily-already-played');
  const dailyBtn = document.getElementById('daily-btn');
  if (dailyMsg && dailyBtn) {
    if (hasDailyBeenPlayed(getTodayStr())) {
      dailyMsg.textContent = "You've already played today's puzzle!";
      dailyMsg.style.display = 'block';
      dailyBtn.disabled = true;
      dailyBtn.textContent = 'Played Today';
    } else {
      dailyMsg.style.display = 'none';
      dailyBtn.disabled = false;
      dailyBtn.textContent = "Play Today's Puzzle";
    }
  }
}

// --- Board Setup ---
async function renderBoardSetup() {
  showScreen('board-setup');
  const genreContainer = document.getElementById('genre-checkboxes');
  if (genreContainer.children.length === 0) {
    const genres = await fetchGenres();
    genres.forEach(g => {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      label.innerHTML = `<input type="checkbox" value="${g.id}"> ${g.name}`;
      genreContainer.appendChild(label);
    });
  }
  const langContainer = document.getElementById('language-checkboxes');
  if (langContainer && langContainer.children.length === 0) {
    const languages = await fetchLanguages();
    languages.forEach(l => {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      label.innerHTML = `<input type="checkbox" value="${l.iso_639_1}"> ${l.english_name}`;
      langContainer.appendChild(label);
    });
  }
}

function renderBoardPreview(movies) {
  const grid = document.getElementById('board-preview');
  grid.innerHTML = `<p style="text-align:center; color:#4cc9f0; font-size:1.1rem; padding:20px;">
    ${movies.length} movies selected. Board is ready!</p>`;
  grid.style.display = 'block';
  document.getElementById('confirm-board-btn').style.display = 'inline-block';
  document.getElementById('confirm-solo-btn').style.display = 'inline-block';
}

// --- Waiting ---
function renderWaiting(data) {
  showScreen('waiting-room');
  document.getElementById('room-code-display').textContent = currentRoom;
  // Movies are hidden until the game starts — no peeking!
  const grid = document.getElementById('waiting-board');
  if (grid) grid.innerHTML = '';
}

// --- Ready Up ---
let readyBound = false;
let opponentJoinedBeeped = false;

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) { /* audio not available */ }
}

function renderReady(data, mySlot) {
  showScreen('ready-screen');

  const otherSlot = mySlot === 'player1' ? 'player2' : 'player1';
  const oppName = data.players[otherSlot] ? data.players[otherSlot].name : 'Opponent';
  document.getElementById('ready-opponent-name').textContent = `Playing against: ${oppName}`;

  // Beep once when opponent joins (for player 1 who was waiting)
  if (mySlot === 'player1' && !opponentJoinedBeeped) {
    opponentJoinedBeeped = true;
    playBeep();
  }

  const myReady = data.ready && data.ready[mySlot];
  const oppReady = data.ready && data.ready[otherSlot];

  const btn = document.getElementById('ready-btn');
  const status = document.getElementById('ready-status');

  if (myReady && oppReady) {
    status.textContent = 'Both ready! Starting...';
    btn.style.display = 'none';
    // Transition to submission
    if (data.state === STATES.READY) {
      setState(currentRoom, STATES.SUBMISSION);
    }
    return;
  }

  if (myReady) {
    btn.style.display = 'none';
    status.textContent = 'Waiting for opponent to ready up...';
  } else if (oppReady) {
    status.textContent = 'Opponent is ready!';
    btn.style.display = 'inline-block';
  } else {
    status.textContent = 'Both players need to ready up.';
    btn.style.display = 'inline-block';
  }

  if (!readyBound) {
    readyBound = true;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Ready!';
      await setReady();
    });
  }
}

// --- Submission ---
function renderSubmission(data, mySlot) {
  if (data.submissions && data.submissions[mySlot] && data.submissions[mySlot].submitted) {
    if (data.solo) {
      if (data.state === STATES.SUBMISSION) runValidation(data);
      else showScreen('validation-screen');
      return;
    }
    showScreen('submission-waiting');
    // Keep timer visible on waiting screen
    updateWaitingTimerDisplay();
    const otherSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const otherSubmitted = data.submissions && data.submissions[otherSlot] && data.submissions[otherSlot].submitted;
    const otherConnected = data.players && data.players[otherSlot] && data.players[otherSlot].connected;
    if (otherSubmitted) {
      if (mySlot === 'player1' && data.state === STATES.SUBMISSION) runValidation(data);
    } else if (!otherConnected) {
      document.getElementById('waiting-message').textContent = 'Opponent disconnected. Finishing game...';
      if (data.state === STATES.SUBMISSION) {
        forceFinishGame(data);
      }
    } else {
      document.getElementById('waiting-message').textContent = 'Waiting for opponent to submit...';
    }
    return;
  }

  showScreen('submission');

  document.getElementById('submission-role').textContent =
    'Name up to 25 actors or directors to cover as many movies as possible. Fewer = more points!';

  const container = document.getElementById('actor-fields');
  if (container.children.length !== MAX_ACTORS) {
    container.innerHTML = '';
    selectedActors = new Array(MAX_ACTORS).fill(null);
    for (let i = 0; i < MAX_ACTORS; i++) {
      container.appendChild(createActorField(i));
    }
    // Scroll first empty field into view
    scrollToNextEmpty();
  }

  if (!submissionTimer) {
    submissionTimeLeft = SUBMISSION_TIME;
    updateTimerDisplay();
    submissionTimer = setInterval(() => {
      submissionTimeLeft--;
      updateTimerDisplay();
      if (submissionTimeLeft <= 0) {
        clearInterval(submissionTimer);
        submissionTimer = null;
        // If we haven't submitted yet, submit now
        if (!roomData || !roomData.submissions || !roomData.submissions[mySlot] || !roomData.submissions[mySlot].submitted) {
          submitActors(selectedActors);
        } else if (!isSoloGame && roomData) {
          // We already submitted, timer expired — force finish
          forceFinishGame(roomData);
        }
      }
    }, 1000);
  }

  const grid = document.getElementById('submission-board');
  if (grid && !grid.hasChildNodes()) {
    const movies = Object.values(data.board.movies);
    movies.forEach(m => {
      const card = document.createElement('div');
      card.className = 'movie-card mini';
      const img = m.posterPath
        ? `<img src="${TMDB_IMG}${m.posterPath}" alt="${m.title}">`
        : `<div class="no-poster"></div>`;
      card.innerHTML = `${img}<span class="movie-title">${m.title}</span>`;
      grid.appendChild(card);
    });
  }
}

function isMobileLayout() {
  return window.innerWidth <= 600;
}

function scrollToNextEmpty() {
  const idx = selectedActors.findIndex(a => a === null);
  if (isMobileLayout()) {
    updateMobileInputBar(idx);
  } else {
    if (idx >= 0) {
      const fields = document.querySelectorAll('#actor-fields .actor-field');
      if (fields[idx]) {
        const input = fields[idx].querySelector('.actor-input');
        if (input && input.style.display !== 'none') {
          input.focus();
        }
      }
    }
  }
}

function updateMobileInputBar(nextIdx) {
  const slot = document.getElementById('mobile-input-slot');
  if (!slot) return;

  const filledCount = selectedActors.filter(a => a !== null).length;

  if (nextIdx < 0) {
    // All fields filled
    slot.innerHTML = `<p class="mobile-input-counter">${filledCount}/25 actors entered</p>`;
    return;
  }

  // Move the actor field into the mobile slot
  const fields = document.querySelectorAll('#actor-fields .actor-field');
  if (!fields[nextIdx]) return;

  slot.innerHTML = '';
  const counter = document.createElement('div');
  counter.className = 'mobile-input-counter';
  counter.textContent = `Actor ${nextIdx + 1}/25 (${filledCount} entered)`;
  slot.appendChild(counter);

  // Move the field to mobile bar
  slot.appendChild(fields[nextIdx]);

  const input = fields[nextIdx].querySelector('.actor-input');
  if (input && input.style.display !== 'none') {
    input.focus();
  }
}

function selectPerson(person, index, input, selectedDisplay, dropdown) {
  selectedActors[index] = { id: person.id, name: person.name };
  input.value = '';
  input.style.display = 'none';
  const roleLabel = person.department === 'Directing' ? ' (dir)' : '';
  selectedDisplay.style.display = 'flex';
  selectedDisplay.innerHTML = `<span>${person.name}${roleLabel}</span><button class="remove-actor" data-index="${index}">&times;</button>`;
  selectedDisplay.querySelector('.remove-actor').addEventListener('click', () => {
    selectedActors[index] = null;
    input.style.display = 'block';
    input.value = '';
    selectedDisplay.style.display = 'none';
    if (isMobileLayout()) {
      // Return field to desktop container then refresh mobile bar
      returnFieldToDesktop(index);
    }
    scrollToNextEmpty();
  });
  dropdown.style.display = 'none';
  activeDropdown = null;
  highlightedIndex = -1;

  if (isMobileLayout()) {
    // Return filled field to desktop container
    returnFieldToDesktop(index);
  }
  // Auto-focus next empty field
  setTimeout(scrollToNextEmpty, 50);
}

function returnFieldToDesktop(index) {
  const container = document.getElementById('actor-fields');
  const slot = document.getElementById('mobile-input-slot');
  if (!slot || !container) return;
  // Find the field in the mobile slot
  const field = slot.querySelector(`.actor-field`);
  if (field && parseInt(field.querySelector('.actor-input')?.dataset?.index) === index) {
    // Insert back in order
    const allFields = container.querySelectorAll('.actor-field');
    let inserted = false;
    for (const f of allFields) {
      const fIdx = parseInt(f.querySelector('.actor-input')?.dataset?.index);
      if (fIdx > index) {
        container.insertBefore(field, f);
        inserted = true;
        break;
      }
    }
    if (!inserted) container.appendChild(field);
  }
}

function createActorField(index) {
  const wrapper = document.createElement('div');
  wrapper.className = 'actor-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = `Actor/Director ${index + 1}`;
  input.className = 'actor-input';
  input.dataset.index = index;

  const dropdown = document.createElement('div');
  dropdown.className = 'actor-dropdown';

  const selectedDisplay = document.createElement('div');
  selectedDisplay.className = 'actor-selected';
  selectedDisplay.style.display = 'none';

  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    highlightedIndex = -1;
    debounceTimer = setTimeout(async () => {
      const results = await searchPerson(e.target.value);
      renderActorDropdown(dropdown, results, index, input, selectedDisplay);
    }, 300);
  });

  input.addEventListener('focus', () => {
    if (dropdown.children.length > 0) dropdown.style.display = 'block';
    activeDropdown = { dropdown, index, input, selectedDisplay };
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    if (items.length === 0 || dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateDropdownHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateDropdownHighlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < items.length) {
        items[highlightedIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
      highlightedIndex = -1;
    }
  });

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);
  wrapper.appendChild(selectedDisplay);
  return wrapper;
}

function updateDropdownHighlight(items) {
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === highlightedIndex);
  });
  // Scroll highlighted item into view within dropdown
  if (highlightedIndex >= 0 && items[highlightedIndex]) {
    items[highlightedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function renderActorDropdown(dropdown, results, index, input, selectedDisplay) {
  dropdown.innerHTML = '';
  highlightedIndex = -1;
  if (results.length === 0) {
    dropdown.style.display = 'none';
    return;
  }
  dropdown.style.display = 'block';

  results.forEach(person => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    const img = person.profilePath
      ? `<img src="${TMDB_IMG}${person.profilePath}" class="actor-thumb">`
      : `<div class="actor-thumb no-photo"></div>`;
    const roleTag = person.department === 'Directing' ? '<span class="role-tag director">Director</span>' : '';
    item.innerHTML = `${img}<div><strong>${person.name}</strong>${roleTag}</div>`;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectPerson(person, index, input, selectedDisplay, dropdown);
    });

    dropdown.appendChild(item);
  });
}

function updateTimerDisplay() {
  const el = document.getElementById('submission-timer');
  if (!el) return;
  const m = Math.floor(submissionTimeLeft / 60);
  const s = submissionTimeLeft % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (submissionTimeLeft <= 30) el.classList.add('urgent');
  else el.classList.remove('urgent');
  updateWaitingTimerDisplay();
}

function updateWaitingTimerDisplay() {
  const el = document.getElementById('waiting-timer');
  if (!el) return;
  const m = Math.floor(submissionTimeLeft / 60);
  const s = submissionTimeLeft % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (submissionTimeLeft <= 30) el.classList.add('urgent');
  else el.classList.remove('urgent');
}

// --- Validation ---
function renderValidation() {
  showScreen('validation-screen');
}

// --- Results ---
function renderResults(data, mySlot) {
  showScreen('results');
  if (!data.results) return;

  const r = data.results;
  const movies = Object.values(data.board.movies);

  clearActiveGame();

  const banner = document.getElementById('result-banner');
  const vsPanel = document.getElementById('vs-score-panel');

  if (r.solo) {
    banner.textContent = `Score: ${r.p1Score} points`;
    banner.className = 'result-banner win';
    const best = getBestSoloScore();
    document.getElementById('result-bid-info').textContent =
      `${r.p1CoveredCount}/25 movies covered with ${r.p1ActorCount} actors | Best: ${best.score} pts`;
    if (vsPanel) vsPanel.style.display = 'none';
  } else {
    const myScore = mySlot === 'player1' ? r.p1Score : r.p2Score;
    const oppScore = mySlot === 'player1' ? r.p2Score : r.p1Score;
    if (r.winner) {
      const isMe = r.winner === mySlot;
      banner.textContent = isMe ? `You win! ${myScore} pts` : `Opponent wins! ${oppScore} pts`;
      banner.className = 'result-banner ' + (isMe ? 'win' : 'lose');
    } else {
      banner.textContent = `It's a tie! ${myScore} pts each`;
      banner.className = 'result-banner draw';
    }
    document.getElementById('result-bid-info').textContent = '';
    const myPid = getPlayerId();
    const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const oppPid = data.players[oppSlot] ? data.players[oppSlot].playerId : null;
    const myName = getPlayerName();
    const oppName = data.players[oppSlot] ? data.players[oppSlot].name : 'Opponent';

    // Player 2 also needs to record the match (player 1 records in runValidation)
    if (mySlot === 'player2' && oppPid && !vsMatchRecorded) {
      vsMatchRecorded = true;
      const p2Score = r.p2Score;
      const p1Score = r.p1Score;
      const myCov = r.p2CoveredCount;
      const oppCov = r.p1CoveredCount;
      recordVsMatch(myPid, oppPid, p2Score, p1Score, myCov, oppCov, oppName);
    }

    if (vsPanel && oppPid) {
      vsPanel.style.display = 'block';
      const totals = getVsTotals(myPid, oppPid);
      const todayEl = document.getElementById('vs-today');
      const allTimeEl = document.getElementById('vs-alltime');
      if (todayEl) todayEl.textContent = `Today: ${myName} ${totals.todayMy} - ${totals.todayOpp} ${oppName}`;
      if (allTimeEl) allTimeEl.textContent = `All-time: ${myName} ${totals.allMy} - ${totals.allOpp} ${oppName}`;
    }
  }

  // Build coverage maps
  const p1Validation = r.p1Validation || [];
  const p2Validation = r.p2Validation || [];

  const p1CoverMap = {};
  const p1MentionedIds = new Set();
  p1Validation.forEach(v => {
    if (v.actor) {
      p1MentionedIds.add(v.actor.id);
      (v.coveredMovies || []).forEach(mid => {
        if (!p1CoverMap[mid]) p1CoverMap[mid] = [];
        p1CoverMap[mid].push(v.actor);
      });
    }
  });
  const p2CoverMap = {};
  const p2MentionedIds = new Set();
  p2Validation.forEach(v => {
    if (v.actor) {
      p2MentionedIds.add(v.actor.id);
      (v.coveredMovies || []).forEach(mid => {
        if (!p2CoverMap[mid]) p2CoverMap[mid] = [];
        p2CoverMap[mid].push(v.actor);
      });
    }
  });

  const myCoverMap = mySlot === 'player1' ? p1CoverMap : p2CoverMap;
  const oppCoverMap = mySlot === 'player1' ? p2CoverMap : p1CoverMap;
  const myMentionedIds = mySlot === 'player1' ? p1MentionedIds : p2MentionedIds;
  const oppMentionedIds = mySlot === 'player1' ? p2MentionedIds : p1MentionedIds;

  const movieCasts = r.movieCasts || {};

  const grid = document.getElementById('results-board');
  grid.innerHTML = '';

  movies.forEach(m => {
    const card = document.createElement('div');
    card.className = 'movie-card result-card';

    const myActors = myCoverMap[m.id] || myCoverMap[String(m.id)] || [];
    const oppActors = oppCoverMap[m.id] || oppCoverMap[String(m.id)] || [];
    const isCovered = myActors.length > 0;

    let coverClass = 'uncovered';
    if (r.solo) {
      coverClass = isCovered ? 'my-covered' : 'uncovered';
    } else {
      if (myActors.length > 0 && oppActors.length > 0) coverClass = 'both-covered';
      else if (myActors.length > 0) coverClass = 'my-covered';
      else if (oppActors.length > 0) coverClass = 'opp-covered';
    }
    card.classList.add(coverClass);

    const img = m.posterPath
      ? `<img src="${TMDB_IMG}${m.posterPath}" alt="${m.title}">`
      : `<div class="no-poster"></div>`;

    const rawCast = movieCasts[m.id] || movieCasts[String(m.id)] || [];
    const topCast = Array.isArray(rawCast) ? rawCast : Object.values(rawCast);
    const topCastIds = new Set(topCast.map(c => c.id));

    const extraMentioned = [];
    (myActors || []).forEach(a => {
      if (!topCastIds.has(a.id)) extraMentioned.push(a);
    });
    if (!r.solo) {
      (oppActors || []).forEach(a => {
        if (!topCastIds.has(a.id) && !extraMentioned.find(e => e.id === a.id)) {
          extraMentioned.push(a);
        }
      });
    }

    const myActorIds = new Set(myActors.map(a => a.id));
    const oppActorIds = new Set(oppActors.map(a => a.id));

    function getMentionClass(personId) {
      const byMe = myActorIds.has(personId) || myMentionedIds.has(personId);
      const byOpp = !r.solo && (oppActorIds.has(personId) || oppMentionedIds.has(personId));
      if (byMe && byOpp) return 'mentioned-both';
      if (byMe) return 'mentioned-me';
      if (byOpp) return 'mentioned-opp';
      return 'not-mentioned';
    }

    let castHtml = '<div class="cast-list">';
    topCast.forEach(c => {
      const cls = getMentionClass(c.id);
      const roleLabel = c.role === 'director' ? ' (dir)' : '';
      castHtml += `<span class="cast-name ${cls}">${c.name}${roleLabel}</span>`;
    });
    extraMentioned.forEach(c => {
      const cls = getMentionClass(c.id);
      castHtml += `<span class="cast-name ${cls} extra">${c.name}</span>`;
    });
    castHtml += '</div>';

    card.innerHTML = `${img}<span class="movie-title">${m.title}</span>${castHtml}`;
    grid.appendChild(card);
  });

  // Player stats
  const myStats = mySlot === 'player1'
    ? { covered: r.p1CoveredCount, actors: r.p1ActorCount, score: r.p1Score }
    : { covered: r.p2CoveredCount, actors: r.p2ActorCount, score: r.p2Score };

  if (r.solo) {
    document.getElementById('my-stats').innerHTML =
      `<h3>${getPlayerName()}</h3><p>${myStats.covered}/25 movies covered<br>${myStats.actors} actors used<br><strong>${myStats.score} points</strong></p>`;
    document.getElementById('opp-stats').innerHTML = '';
  } else {
    const oppStats = mySlot === 'player1'
      ? { covered: r.p2CoveredCount, actors: r.p2ActorCount, score: r.p2Score }
      : { covered: r.p1CoveredCount, actors: r.p1ActorCount, score: r.p1Score };
    const oppSlot = mySlot === 'player1' ? 'player2' : 'player1';
    const oppName = data.players[oppSlot] ? data.players[oppSlot].name : 'Opponent';
    document.getElementById('my-stats').innerHTML =
      `<h3>${getPlayerName()}</h3><p>${myStats.covered}/25 movies covered<br>${myStats.actors} actors used<br><strong>${myStats.score} points</strong></p>`;
    document.getElementById('opp-stats').innerHTML =
      `<h3>${oppName}</h3><p>${oppStats.covered}/25 movies covered<br>${oppStats.actors} actors used<br><strong>${oppStats.score} points</strong></p>`;
  }
}

// --- Solo Leaderboard ---
function renderSoloLeaderboard() {
  showScreen('solo-leaderboard');
  const list = document.getElementById('solo-leaderboard-list');
  list.innerHTML = '';
  const lb = getSoloLeaderboard();
  if (lb.length === 0) {
    list.innerHTML = '<p class="empty-message">No solo games played yet.</p>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'leaderboard-table';
  table.innerHTML = `<thead><tr><th>#</th><th>Player</th><th>Score</th><th>Movies</th><th>Actors</th><th>Date</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  lb.forEach((entry, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td><strong>${entry.score}</strong></td><td>${entry.covered}/25</td><td>${entry.actors}</td><td>${entry.date || ''}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  list.appendChild(table);
}

// --- Daily Leaderboard ---
async function renderDailyLeaderboard() {
  showScreen('daily-leaderboard');
  const dateStr = getTodayStr();
  document.getElementById('daily-lb-title').textContent = `Daily Puzzle — ${dateStr}`;
  const list = document.getElementById('daily-leaderboard-list');
  list.innerHTML = '<p class="empty-message">Loading...</p>';

  const scores = await readDailyScores(dateStr);
  list.innerHTML = '';

  if (!scores) {
    list.innerHTML = '<p class="empty-message">No one has played today\'s puzzle yet.</p>';
    return;
  }

  const entries = Object.values(scores).sort((a, b) => b.score - a.score);
  const table = document.createElement('table');
  table.className = 'leaderboard-table';
  table.innerHTML = `<thead><tr><th>#</th><th>Player</th><th>Score</th><th>Movies</th><th>Actors</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  entries.forEach((entry, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td><strong>${entry.score}</strong></td><td>${entry.covered}/25</td><td>${entry.actors}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  list.appendChild(table);
}

// --- VS Stats ---
function renderVsStats() {
  showScreen('vs-stats');
  const listEl = document.getElementById('vs-opponents-list');
  const detailEl = document.getElementById('vs-detail-panel');
  detailEl.style.display = 'none';
  listEl.innerHTML = '';

  const opponents = getVsOpponents();
  const myId = getPlayerId();
  const entries = Object.entries(opponents);

  if (entries.length === 0) {
    listEl.innerHTML = '<p class="empty-message">No VS games played yet.</p>';
    return;
  }

  entries.forEach(([oppId, oppName]) => {
    const totals = getVsTotals(myId, oppId);
    const btn = document.createElement('button');
    btn.className = 'opponent-btn';
    btn.innerHTML = `<span class="opp-name">${oppName}</span><span class="opp-record">${totals.wins}W - ${totals.losses}L (${totals.matchCount} games)</span>`;
    btn.addEventListener('click', () => renderVsDetail(oppId, oppName));
    listEl.appendChild(btn);
  });
}

function renderVsDetail(oppId, oppName) {
  const detailEl = document.getElementById('vs-detail-panel');
  detailEl.style.display = 'block';

  const myId = getPlayerId();
  const myName = getPlayerName();
  const t = getVsTotals(myId, oppId);

  detailEl.innerHTML = `
    <h3>${myName} vs ${oppName}</h3>
    <div class="vs-detail-grid">
      <div class="vs-stat-box">
        <div class="vs-stat-label">Matches</div>
        <div class="vs-stat-value">${t.matchCount}</div>
      </div>
      <div class="vs-stat-box win">
        <div class="vs-stat-label">Won</div>
        <div class="vs-stat-value">${t.wins}</div>
      </div>
      <div class="vs-stat-box lose">
        <div class="vs-stat-label">Lost</div>
        <div class="vs-stat-value">${t.losses}</div>
      </div>
      <div class="vs-stat-box">
        <div class="vs-stat-label">Draws</div>
        <div class="vs-stat-value">${t.draws}</div>
      </div>
    </div>
    <div class="vs-detail-row">
      <span>Total Points</span>
      <strong>${myName} ${t.allMy} - ${t.allOpp} ${oppName}</strong>
    </div>
    <div class="vs-detail-row">
      <span>Total Movies Covered</span>
      <strong>${myName} ${t.totalMyCovered} - ${t.totalOppCovered} ${oppName}</strong>
    </div>
    <div class="vs-detail-row">
      <span>Today</span>
      <strong>${myName} ${t.todayMy} - ${t.todayOpp} ${oppName}</strong>
    </div>
  `;

  detailEl.scrollIntoView({ behavior: 'smooth' });
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.actor-field')) {
    document.querySelectorAll('.actor-dropdown').forEach(d => d.style.display = 'none');
    activeDropdown = null;
    highlightedIndex = -1;
  }
});
