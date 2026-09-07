// Cognitus Staff / Command intentionally uses the same Firebase project as
// the public Cognitus Solutions portal. Firebase web configuration is public
// client configuration; Firestore Security Rules are the real authorization
// boundary.

export const firebaseConfig = {
  apiKey: "AIzaSyCdif9RywlIRQpLp_J-8TM_rp-u3iC49Zs",
  authDomain: "cognitus-solutions.firebaseapp.com",
  projectId: "cognitus-solutions",
  storageBucket: "cognitus-solutions.firebasestorage.app",
  messagingSenderId: "872227518492",
  appId: "1:872227518492:web:3224cb731345a8e43607d9"
};

export const firebaseReady = true;
