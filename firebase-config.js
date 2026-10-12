/* =====================================================================
   STEP 1 — Paste your Firebase web app config here.
   Firebase console → ⚙️ Project settings → General → "Your apps"
   → select your web app (</>) → "SDK setup and configuration" → Config.
   (This config is meant to be public. Security comes from firestore.rules.)
   ===================================================================== */
window.SS_CONFIG = window.SS_CONFIG || {};
window.SS_CONFIG.firebaseConfig = {
  apiKey: "AIzaSyAsyzhx1DXmJAIxUXKy-0NsDjxa0fNkP4c",
  authDomain: "event-portal-7b254.firebaseapp.com",
  projectId: "event-portal-7b254",
  storageBucket: "event-portal-7b254.firebasestorage.app",
  messagingSenderId: "62606166741",
  appId: "1:62606166741:web:85c4d769b6d6d83832305c"
};


/* =====================================================================
   STEP 2 — Organizer (admin) emails, all lowercase.
   ⚠️ Put the SAME emails in firestore.rules (function isAdmin) —
   the rules are what actually protect the data.
   ===================================================================== */
window.SS_CONFIG.ADMIN_EMAILS = [
  "your.admin.raimondal075@gmail.com"
];
