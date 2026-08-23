/* ============================================================
   MAMBEMBA BUSINESS — Configuração Firebase
   Liga a app à conta Firebase do projeto mambemba-business-eceb9.
   ============================================================ */
(function () {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyDoEucxM6OTE2Edce-lApOIjcaam7wRiDw",
    authDomain: "mambemba-business-eceb9.firebaseapp.com",
    projectId: "mambemba-business-eceb9",
    storageBucket: "mambemba-business-eceb9.firebasestorage.app",
    messagingSenderId: "616239210901",
    appId: "1:616239210901:web:4f0ae10c68cde3f103169c"
  };

  // App principal — usada para login normal, Firestore e Storage.
  var app = firebase.initializeApp(firebaseConfig);

  // App secundária — usada SÓ para criar novos utilizadores (Equipa) sem
  // substituir a sessão do Admin que está a criar o utilizador.
  // (createUserWithEmailAndPassword troca automaticamente a sessão ativa
  // para o novo utilizador; correr isto numa instância separada evita isso.)
  var secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");

  window.MB_FIREBASE = {
    app: app,
    auth: firebase.auth(),
    db: firebase.firestore(),
    storage: firebase.storage(),
    secondaryAuth: secondaryApp.auth()
  };
})();
