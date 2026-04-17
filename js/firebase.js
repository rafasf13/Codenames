const firebaseConfig = {
  apiKey: "AIzaSyCJGHainBPSqLEqIIXLSkxwLtZ1GTLESRQ",
  authDomain: "codemovies-15b34.firebaseapp.com",
  databaseURL: "https://codemovies-15b34-default-rtdb.firebaseio.com",
  projectId: "codemovies-15b34",
  storageBucket: "codemovies-15b34.firebasestorage.app",
  messagingSenderId: "77582229370",
  appId: "1:77582229370:web:a224fa6bd08b79545180c3",
  measurementId: "G-RHK1HXEMN3"
};

let app, db, auth, currentUser = null;

function initFirebase() {
  app = firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  auth = firebase.auth();
  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      if (user) {
        currentUser = user;
        resolve(currentUser);
      } else {
        auth.signInAnonymously().then((cred) => {
          currentUser = cred.user;
          resolve(currentUser);
        });
      }
    });
  });
}

async function logOut() {
  await auth.signOut();
  currentUser = null;
  localStorage.removeItem('cinenames_player');
  clearActiveGame();
  window.location.reload();
}

function getUid() {
  return currentUser ? currentUser.uid : null;
}

function roomRef(roomCode) {
  return db.ref('rooms/' + roomCode);
}

function writeRoom(roomCode, data) {
  return roomRef(roomCode).set(data);
}

function updateRoom(roomCode, updates) {
  return roomRef(roomCode).update(updates);
}

function readRoom(roomCode) {
  return roomRef(roomCode).once('value').then(snap => snap.val());
}

function listenToRoom(roomCode, callback) {
  roomRef(roomCode).on('value', snap => callback(snap.val()));
}

function stopListening(roomCode) {
  roomRef(roomCode).off();
}

function writeSubmission(roomCode, playerSlot, data) {
  return roomRef(roomCode).child('submissions/' + playerSlot).set(data);
}

function writeBid(roomCode, bidData) {
  return roomRef(roomCode).child('bidding').update(bidData);
}

function pushBidHistory(roomCode, entry) {
  return roomRef(roomCode).child('bidding/history').push(entry);
}

function writeResults(roomCode, results) {
  return roomRef(roomCode).child('results').set(results);
}

function setState(roomCode, state) {
  return roomRef(roomCode).child('state').set(state);
}

// --- Daily Puzzle ---
function dailyRef(dateStr) {
  return db.ref('daily/' + dateStr);
}

function writeDailyBoard(dateStr, moviesData) {
  return dailyRef(dateStr).child('board').set({ movies: moviesData });
}

function readDaily(dateStr) {
  return dailyRef(dateStr).once('value').then(snap => snap.val());
}

function writeDailyScore(dateStr, playerId, scoreData) {
  return dailyRef(dateStr).child('scores/' + playerId).set(scoreData);
}

function readDailyScores(dateStr) {
  return dailyRef(dateStr).child('scores').once('value').then(snap => snap.val());
}

// --- User Profile (cloud-synced stats) ---
function userRef(uid) {
  return db.ref('users/' + uid);
}

function writeUserProfile(uid, data) {
  return userRef(uid).set(data);
}

function readUserProfile(uid) {
  return userRef(uid).once('value').then(snap => snap.val());
}

function updateUserProfile(uid, updates) {
  return userRef(uid).update(updates);
}

// --- Email Link Auth ---
function sendSignInLink(email) {
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true
  };
  return auth.sendSignInLinkToEmail(email, actionCodeSettings).then(() => {
    localStorage.setItem('cinenames_email_for_signin', email);
  });
}

function isSignInLink(url) {
  return auth.isSignInWithEmailLink(url);
}

async function completeSignInWithLink(email, url) {
  const currentAnonymousUser = auth.currentUser;
  const credential = firebase.auth.EmailAuthProvider.credentialWithLink(email, url);

  if (currentAnonymousUser && currentAnonymousUser.isAnonymous) {
    // Link email to existing anonymous account — preserves UID
    const result = await currentAnonymousUser.linkWithCredential(credential);
    currentUser = result.user;
    return currentUser;
  } else {
    // Sign in directly
    const result = await auth.signInWithEmailLink(email, url);
    currentUser = result.user;
    return currentUser;
  }
}

function isEmailLinked() {
  if (!currentUser) return false;
  return currentUser.providerData.some(p => p.providerId === 'password');
}

function getLinkedEmail() {
  if (!currentUser) return null;
  const emailProvider = currentUser.providerData.find(p => p.providerId === 'password');
  return emailProvider ? emailProvider.email : null;
}

function onDisconnectCleanup(roomCode, playerSlot) {
  roomRef(roomCode).child('players/' + playerSlot + '/connected').onDisconnect().set(false);
  roomRef(roomCode).child('players/' + playerSlot + '/connected').set(true);
}
