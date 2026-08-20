// Substitua os valores abaixo pela configuração Web do seu projeto Firebase.
// Este ficheiro é necessário para notificações push em segundo plano.
importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "COLOQUE_AQUI",
  authDomain: "COLOQUE_AQUI.firebaseapp.com",
  projectId: "COLOQUE_AQUI",
  storageBucket: "COLOQUE_AQUI.firebasestorage.app",
  messagingSenderId: "COLOQUE_AQUI",
  appId: "COLOQUE_AQUI"
});

firebase.messaging();
