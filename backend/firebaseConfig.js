// backend/firebaseConfig.js
const admin = require('firebase-admin');
const serviceAccount = require('./ufc-prediction-task-firebase-adminsdk-fbsvc-06c876478e.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Export both admin and Firestore for convenience
const firestore = admin.firestore();

module.exports = { admin, firestore };
