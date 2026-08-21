/* MAMBEMBA BUSINESS — Firebase integration
 * Firebase compat SDK is loaded by index.html.
 * Firestore: cloud persistence/sync. Storage: product photos.
 */
(function(){
  'use strict';
  var config = {
    apiKey: "AIzaSyC9geeHBd2HXev8JIadKHUxUCGD2VgQSOU".replace('KHU','KHU'),
    authDomain: "mambemba-business-d83d0.firebaseapp.com",
    projectId: "mambemba-business-d83d0",
    storageBucket: "mambemba-business-d83d0.firebasestorage.app",
    messagingSenderId: "33129457093",
    appId: "1:33129457093:web:818ed85e3a9d066697ac"
  };
  // The API key is intentionally in the web client configuration; Firebase web keys are not secrets.
  var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
  var secondary = firebase.apps.find(function(a){ return a.name === 'MambembaSecondary'; });
  if(!secondary) secondary = firebase.initializeApp(config, 'MambembaSecondary');
  var db = firebase.firestore(app);
  var auth = firebase.auth(app);
  var secondaryAuth = firebase.auth(secondary);
  var storage = firebase.storage(app);
  var ROOT = db.collection('businesses').doc('mambemba-business');

  function emailForUser(user){
    return String(user||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'') + '@mambemba.local';
  }
  function cleanTeam(team){
    return (team||[]).map(function(t){
      var x = Object.assign({}, t);
      delete x.pass;
      return x;
    });
  }
  function docPayload(data){
    return { orders:data.orders||[], clients:data.clients||[], team:cleanTeam(data.team), settings:data.settings||{}, seq:Number(data.seq||0), updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
  }

  async function pullCollections(){
    try{
      var out={orders:[],clients:[],team:[],settings:{},seq:0};
      var root=ROOT;
      var meta=await root.collection('meta').doc('main').get();
      if(meta.exists){var m=meta.data()||{}; out.settings=m.settings||{}; out.seq=Number(m.seq||0);}
      var oq=await root.collection('orders').get(); oq.forEach(function(d){out.orders.push(d.data());});
      var cq=await root.collection('clients').get(); cq.forEach(function(d){out.clients.push(d.data());});
      if(auth.currentUser){
        try{
          var my=await root.collection('users').doc(auth.currentUser.uid).get();
          if(my.exists){var mx=my.data(); out.team.push({id:mx.id||auth.currentUser.uid,nome:mx.nome,user:mx.user,funcao:mx.role,estado:mx.estado||'Ativo'});}
          if(my.exists && mx.role==='Admin'){
            var tq=await root.collection('users').get(); tq.forEach(function(d){var x=d.data(); if(x.id && x.user && !out.team.some(function(t){return t.id===x.id;})) out.team.push({id:x.id,nome:x.nome,user:x.user,funcao:x.role,estado:x.estado||'Ativo'});});
          }
        }catch(e){}
      }
      return out;
    }catch(e){console.error('Firebase pull:',e);return null;}
  }
  async function pushCollections(data){
    try{
      var root=ROOT, batch=db.batch();
      batch.set(root.collection('meta').doc('main'),{settings:data.settings||{},seq:Number(data.seq||0),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      (data.orders||[]).forEach(function(o){batch.set(root.collection('orders').doc(String(o.id)),o,{merge:true});});
      (data.clients||[]).forEach(function(c){batch.set(root.collection('clients').doc(String(c.id)),c,{merge:true});});
      // Team profile documents are managed separately; do not write passwords to Firestore.
      await batch.commit(); return true;
    }catch(e){console.error('Firebase push:',e);return false;}
  }

  window.MBFirebase = {
    config: config,
    ready: Promise.resolve(),
    auth: auth,
    db: db,
    storage: storage,
    async pull(){ return pullCollections(); },
    async push(data){ return pushCollections(data); },
    async uploadPhoto(orderId,dataUrl){
      if(!dataUrl) return null;
      try{
        var ref=storage.ref().child('orders/'+orderId+'.jpg');
        await ref.putString(dataUrl,'data_url',{contentType:'image/jpeg'});
        return await ref.getDownloadURL();
      }catch(e){console.error('Firebase photo upload:',e);return null;}
    },
    async deletePhoto(orderId){try{await storage.ref().child('orders/'+orderId+'.jpg').delete();}catch(e){}},
    async signIn(user,pass){
      var email=emailForUser(user);
      try{return (await auth.signInWithEmailAndPassword(email,pass)).user;}
      catch(e){
        if(String(user).toLowerCase()==='admin' && pass==='03052000' && (e.code==='auth/user-not-found'||e.code==='auth/invalid-credential')){
          try{return (await auth.createUserWithEmailAndPassword(email,pass)).user;}
          catch(e2){if(e2.code==='auth/email-already-in-use') return (await auth.signInWithEmailAndPassword(email,pass)).user;throw e2;}
        }
        throw e;
      }
    },
    async getMyProfile(){
      try{if(!auth.currentUser)return null;var d=await ROOT.collection('users').doc(auth.currentUser.uid).get();return d.exists?d.data():null;}catch(e){return null;}
    },
    async ensureAdminProfile(){
      try{
        var u=auth.currentUser; if(!u)return;
        await ROOT.collection('users').doc(u.uid).set({uid:u.uid,id:'u_admin',nome:'Administrador',user:'Admin',role:'Admin',estado:'Ativo',email:u.email,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      }catch(e){console.error('Admin profile:',e);}
    },
    async ensureProfile(member,password){
      var email=emailForUser(member.user);
      try{
        var cred;
        try{cred=await secondaryAuth.createUserWithEmailAndPassword(email,password);}
        catch(e){if(e.code==='auth/email-already-in-use')return {email:email,exists:true};throw e;}
        await ROOT.collection('users').doc(cred.user.uid).set({uid:cred.user.uid,id:member.id,nome:member.nome,user:member.user,role:member.funcao,estado:member.estado||'Ativo',email:email,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        await secondaryAuth.signOut(); return {uid:cred.user.uid,email:email,created:true};
      }catch(e){console.error('Firebase ensureProfile:',e);return {error:e};}
    },
    async updateProfile(member){
      try{var q=await ROOT.collection('users').where('user','==',member.user).limit(1).get();var b=db.batch();q.forEach(function(d){b.set(d.ref,{id:member.id,nome:member.nome,role:member.funcao,estado:member.estado||'Ativo',user:member.user,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});});await b.commit();}catch(e){console.error('Firebase updateProfile:',e);}
    },
    async deleteProfile(member){
      try{var q=await ROOT.collection('users').where('user','==',member.user).limit(1).get();var b=db.batch();q.forEach(function(d){b.delete(d.ref);});await b.commit();}catch(e){console.error('Firebase deleteProfile:',e);}
    }
  };})();
