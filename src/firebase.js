import { firebaseConfig, firebaseReady } from "./config/firebaseConfig.js";

export const FIREBASE_SDK_VERSION = "12.15.0";
export const FIREBASE_CDN_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let app = null;
let auth = null;
let db = null;
let Auth = null;
let Fire = null;

export async function initializeFirebase() {
  if (!firebaseReady) {
    throw new Error("Firebase is not configured.");
  }

  if (app && auth && db && Auth && Fire) {
    return { app, auth, db, Auth, Fire };
  }

  const [AppModule, AuthModule, FirestoreModule] = await Promise.all([
    import(`${FIREBASE_CDN_BASE}/firebase-app.js`),
    import(`${FIREBASE_CDN_BASE}/firebase-auth.js`),
    import(`${FIREBASE_CDN_BASE}/firebase-firestore.js`)
  ]);

  app = AppModule.initializeApp(firebaseConfig);
  auth = AuthModule.getAuth(app);
  db = FirestoreModule.getFirestore(app);
  Auth = AuthModule;
  Fire = FirestoreModule;

  return { app, auth, db, Auth, Fire };
}

export function firebaseState() {
  return { app, auth, db, Auth, Fire, ready: Boolean(app && auth && db && Auth && Fire) };
}

export async function readDoc(collectionName, id) {
  if (!id) return null;
  const { db, Fire } = firebaseState();
  const snapshot = await Fire.getDoc(Fire.doc(db, collectionName, id));
  return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
}

export async function readQuery(collectionName, constraints = []) {
  const { db, Fire } = firebaseState();
  const snapshot = await Fire.getDocs(Fire.query(Fire.collection(db, collectionName), ...constraints));
  return snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
}

export async function readCollection(collectionName) {
  const { db, Fire } = firebaseState();
  const snapshot = await Fire.getDocs(Fire.collection(db, collectionName));
  return snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
}

export async function setDocument(collectionName, id, data, options) {
  const { db, Fire } = firebaseState();
  return Fire.setDoc(Fire.doc(db, collectionName, id), data, options);
}

export async function updateDocument(collectionName, id, data) {
  const { db, Fire } = firebaseState();
  return Fire.updateDoc(Fire.doc(db, collectionName, id), data);
}

export function serverTimestamp() {
  return firebaseState().Fire.serverTimestamp();
}

export function firestoreDoc(collectionName, id) {
  const { db, Fire } = firebaseState();
  return Fire.doc(db, collectionName, id);
}

export function newFirestoreDoc(collectionName) {
  const { db, Fire } = firebaseState();
  return Fire.doc(Fire.collection(db, collectionName));
}

export function writeBatch() {
  const { db, Fire } = firebaseState();
  return Fire.writeBatch(db);
}
