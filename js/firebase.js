const firebaseConfig = {
  apiKey: "AIzaSyDzmkyfmFDfHVPu8QoXikuVgqnfEuGIL74",
  authDomain: "codemovies-15b34.firebaseapp.com",
  databaseURL: "https://codemovies-15b34-default-rtdb.firebaseio.com",
  projectId: "codemovies-15b34",
  storageBucket: "codemovies-15b34.firebasestorage.app",
  messagingSenderId: "77582229370",
  appId: "1:77582229370:web:b38f4a54a327e0be5180c3",
  measurementId: "G-6R6B6B2ZRZ"
};

let app, db, auth, currentUser = null;

function initFirebase() {
  app = firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  auth = firebase.auth();
  return auth.signInAnonymously().then((cred) => {
    currentUser = cred.user;
    return currentUser;
  });
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

function onDisconnectCleanup(roomCode, playerSlot) {
  roomRef(roomCode).child('players/' + playerSlot + '/connected').onDisconnect().set(false);
  roomRef(roomCode).child('players/' + playerSlot + '/connected').set(true);
}
