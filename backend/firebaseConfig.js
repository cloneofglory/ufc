const admin = require('firebase-admin');
const dotenv = require('dotenv').config();

let firebaseConfig;

if (process.env.FIREBASE_PRIVATE_KEY) {
  firebaseConfig = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
  };
} else {
  try {
    const serviceAccount = require('./ufc-prediction-task-firebase-adminsdk-fbsvc-06c876478e.json');
    firebaseConfig = serviceAccount;
  } catch (error) {
    console.error("Firebase credentials not found:", error);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig)
});

const firestore = admin.firestore();

module.exports = { admin, firestore };
