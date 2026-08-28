/* ============================================================
   MAMBEMBA BUSINESS — v3.3 — app.js
   Aplicação estática (HTML + CSS + JS puro) ligada ao Firebase:
   - Firebase Auth (email/palavra-passe) — login por utilizador da equipa
   - Cloud Firestore — encomendas, clientes, definições e equipa (sync entre dispositivos)
   - Firebase Storage — fotos dos produtos
   Continua sem servidor próprio: tudo corre no navegador + Firebase.
   ============================================================ */
(function () {
  "use strict";

  var FB = window.MB_FIREBASE;
  var auth = FB.auth;
  var db = FB.db;
  // Nota: comentário informativo — este projeto não usa o Firebase Storage
  // (a Google passou a exigir o plano pago Blaze para o Storage). Fotos
  // ficam guardadas em Cloud Firestore, que continua gratuito.
  var secondaryAuth = FB.secondaryAuth;
  var dataDocRef = db.collection("app_data").doc("main");
  var teamColRef = db.collection("team");

  /* ---------------------------------------------------------
     0) TEMA (Aparência) — Claro / Escuro / Cores da marca / Sistema.
     Preferência pessoal, guardada só neste aparelho (localStorage),
     nunca sincronizada nem aplicada na tela de login/validação pública.
     A aplicação inicial já acontece mais cedo, num script no <head> do
     index.html (evita "flash" da cor errada); aqui só tratamos da
     mudança em tempo real e da opção "sistema" reagir ao SO.
     --------------------------------------------------------- */
  var THEME_KEY = "mb_theme_pref";
  function getThemePref() {
    try { return localStorage.getItem(THEME_KEY) || "sistema"; } catch (e) { return "sistema"; }
  }
  function resolveSystemTheme() {
    return (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "escuro" : "claro";
  }
  function applyTheme(pref) {
    var effective = pref === "sistema" ? resolveSystemTheme() : pref;
    if (effective === "claro") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", effective);
  }
  function setThemePref(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
    applyTheme(pref);
  }
  applyTheme(getThemePref());
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (getThemePref() === "sistema") applyTheme("sistema");
    });
  }


  /* ---------------------------------------------------------
     1) CONSTANTES
     --------------------------------------------------------- */
  var PERMISSIONS = {
    "Admin":      ["dashboard", "encomendas", "clientes", "equipa", "financeiro", "definicoes"],
    "Gestor":     ["dashboard", "encomendas", "clientes", "equipa", "financeiro", "definicoes"],
    "Vendedor":   ["dashboard", "encomendas", "clientes", "definicoes"],
    "Entregador": ["dashboard", "encomendas", "definicoes"],
    "Financeiro": ["dashboard", "financeiro", "definicoes"]
  };

  var DEFAULT_DATA = {
    orders: [],
    clients: [],
    settings: { nome: "MAMBEMBA BUSINESS", slogan: "Cuidamos do teu estilo." },
    seq: 0
  };

  /* ---------------------------------------------------------
     2) PERSISTÊNCIA — Cloud Firestore
     A equipa vive na coleção "team" (1 documento por utilizador,
     ID = UID do Firebase Auth). As encomendas/clientes/definições
     vivem num único documento "app_data/main", sincronizado em
     tempo real (onSnapshot) entre todos os dispositivos.
     --------------------------------------------------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DB = clone(DEFAULT_DATA);
  DB.team = []; // preenchida via onSnapshot da coleção "team"
  var currentSession = null; // { uid, nome, role, email }
  var dataReady = false, teamReady = false;

  function persist() {
    dataDocRef.set({
      orders: DB.orders,
      clients: DB.clients,
      settings: DB.settings,
      seq: DB.seq
    }, { merge: false }).catch(function (e) {
      console.error("Erro ao guardar no Firestore:", e);
      toast("Não foi possível guardar — verifique a ligação à internet.", "error");
    });
  }

  function startDataSync() {
    dataDocRef.onSnapshot(function (snap) {
      if (snap.exists) {
        var d = snap.data();
        DB.orders = d.orders || [];
        DB.clients = d.clients || [];
        DB.settings = d.settings || clone(DEFAULT_DATA.settings);
        DB.seq = typeof d.seq === "number" ? d.seq : DB.orders.length;
      } else {
        dataDocRef.set(DEFAULT_DATA);
      }
      dataReady = true;
      applyBranding();
      if (getCurrentUser()) router();
      backfillReceiptSummaries();
    }, function (err) {
      console.error("Erro de sincronização (dados):", err);
    });

    teamColRef.onSnapshot(function (snap) {
      DB.team = snap.docs.map(function (docSnap) {
        var t = docSnap.data();
        return {
          id: docSnap.id,
          nome: t.nome,
          user: t.email, // mantém o nome de campo "user" usado no resto do app
          email: t.email,
          funcao: t.funcao,
          estado: t.estado
        };
      });
      teamReady = true;
      if (getCurrentUser() && currentRoute().indexOf("equipa") !== -1) renderTeam();
    }, function (err) {
      console.error("Erro de sincronização (equipa):", err);
    });
  }

  function getCurrentUser() {
    return currentSession;
  }

  function applyBranding() {
    var s = DB.settings || {};
    var nome = s.nome || "MAMBEMBA BUSINESS";
    var slogan = s.slogan || "Cuidamos do teu estilo.";
    document.title = nome + " — Painel";

    var blackPart = document.querySelector(".login-title .black-part");
    var redPart = document.querySelector(".login-title .red-part");
    if (blackPart && redPart) {
      var spaceIdx = nome.indexOf(" ");
      if (spaceIdx === -1) { blackPart.textContent = nome; redPart.textContent = ""; }
      else { blackPart.textContent = nome.slice(0, spaceIdx); redPart.textContent = nome.slice(spaceIdx + 1); }
    }
    var topbarStrong = document.querySelector(".topbar-titles strong");
    if (topbarStrong) topbarStrong.textContent = nome;
  }
  applyBranding();
  startDataSync();

  /* ---------------------------------------------------------
     3) PERSISTÊNCIA — Cloud Firestore (fotos dos produtos)
     Sem custos: guarda cada foto (já comprimida em JPEG ~poucas
     centenas de KB) como um documento na coleção "photos"
     (photos/{orderId} → { data: "data:image/jpeg;base64,..." }),
     visível em qualquer dispositivo com sessão iniciada.
     (Não usa o Firebase Storage porque este passou a exigir o
     plano pago Blaze; Firestore continua gratuito no plano Spark.)
     --------------------------------------------------------- */
  var photosColRef = db.collection("photos");
  var receiptsColRef = db.collection("receipts");

  // Resumo público do recibo (sem dados pessoais do cliente), usado só para
  // a validação por QR Code funcionar sem sessão iniciada.
  function saveReceiptSummary(order) {
    var total = Number(order.custo || 0) + Number(order.taxi || 0);
    return receiptsColRef.doc(order.id).set({
      produto: order.produto || "",
      categoria: order.categoria || "",
      custo: Number(order.custo || 0),
      taxi: Number(order.taxi || 0),
      total: total,
      estado: order.estado || "PENDENTE",
      data: order.data || "",
      horario: order.horario || ""
    }).then(function () { return { ok: true }; }).catch(function (e) {
      console.error("Erro ao guardar resumo do recibo:", e);
      return { ok: false, code: e.code, message: e.message };
    });
  }
  function deleteReceiptSummary(orderId) {
    receiptsColRef.doc(orderId).delete().catch(function () { /* já não existia */ });
  }
  var receiptsBackfilled = false;
  function backfillReceiptSummaries() {
    if (receiptsBackfilled || !getCurrentUser() || !DB.orders.length) return;
    receiptsBackfilled = true;
    receiptsColRef.get().then(function (snap) {
      var existing = {};
      snap.forEach(function (d) { existing[d.id] = true; });
      var missing = DB.orders.filter(function (o) { return !existing[o.id]; });
      if (!missing.length) { toast("Resumos de recibo já estavam todos completos (" + snap.size + ")."); return; }
      Promise.all(missing.map(saveReceiptSummary)).then(function (results) {
        var okCount = results.filter(function (r) { return r.ok; }).length;
        var failed = results.filter(function (r) { return !r.ok; });
        if (failed.length) {
          toast("Resumos criados: " + okCount + "/" + missing.length + ". Erro: (" + (failed[0].code || "erro") + ") " + (failed[0].message || ""), "error");
        } else {
          toast(okCount + " resumo(s) de recibo criado(s) com sucesso.", "success");
        }
      });
    }).catch(function (err) {
      console.error("Erro ao preencher resumos de recibo:", err);
      toast("Falha ao listar resumos de recibo (" + (err.code || "erro") + "): " + (err.message || ""), "error");
    });
  }

  // Guarda até 5 fotos por encomenda: photos/{orderId} → { images: ["data:image/jpeg;base64,...", ...] }
  function savePhoto(orderId, dataUrls) {
    var images = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
    return photosColRef.doc(orderId).set({ images: images }).then(function () {
      return { ok: true };
    }).catch(function (e) {
      console.error("Erro ao guardar fotos:", e);
      return { ok: false, code: e.code, message: e.message };
    });
  }
  var photoUrlCache = {}; // orderId -> array de dataURLs (evita pedidos repetidos)
  function getPhotos(orderId) {
    if (photoUrlCache[orderId] !== undefined) return Promise.resolve(photoUrlCache[orderId] || []);
    return photosColRef.doc(orderId).get().then(function (docSnap) {
      var d = docSnap.exists ? docSnap.data() : null;
      var images = d ? (d.images || (d.data ? [d.data] : [])) : []; // compatível com registos antigos (campo "data" único)
      photoUrlCache[orderId] = images;
      return images;
    }).catch(function () {
      photoUrlCache[orderId] = [];
      return [];
    });
  }
  // Mantido para compatibilidade: devolve só a primeira foto (usada nas miniaturas dos cartões).
  function getPhoto(orderId) {
    return getPhotos(orderId).then(function (images) { return images[0] || null; });
  }
  function deletePhoto(orderId) {
    delete photoUrlCache[orderId];
    return photosColRef.doc(orderId).delete().catch(function () { /* já não existia */ });
  }
  var photoCache = {}; // orderId -> dataURL (primeira foto) pendente para pré-visualização nos cartões

  /* ---------------------------------------------------------
     4) UTILITÁRIOS
     --------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function fmtKz(n) { n = Number(n) || 0; return n.toLocaleString("pt-PT") + " Kz"; }
  function uid(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function nextOrderId() {
    DB.seq = (DB.seq || 0) + 1;
    var year = new Date().getFullYear();
    var seqStr = String(DB.seq).padStart(6, "0");
    return "MB-" + year + "-" + seqStr;
  }

  function normalizeAngolaPhone(raw) {
    if (!raw) return "";
    var digits = String(raw).replace(/\D/g, "");
    if (digits.indexOf("244") === 0) return digits;
    if (digits.length === 9 && digits[0] === "9") return "244" + digits;
    if (digits.length === 10 && digits[0] === "0") return "244" + digits.slice(1);
    if (digits.length > 9) return digits; // assume already has country code of some kind
    return "244" + digits;
  }

  var toastTimer = null;
  function toast(msg, type) {
    var el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function confirmDialog(message) {
    return new Promise(function (resolve) {
      var modal = $("#confirmModal");
      $("#confirmMessage").textContent = message;
      modal.hidden = false;
      function cleanup(result) {
        modal.hidden = true;
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      var okBtn = $("#confirmOkBtn"), cancelBtn = $("#confirmCancelBtn");
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------
     5) AUTENTICAÇÃO
     --------------------------------------------------------- */
  var loginForm = $("#loginForm");
  var loginUser = $("#loginUser");
  var loginPass = $("#loginPass");
  var loginError = $("#loginError");

  $("#togglePass").addEventListener("click", function () {
    var isPass = loginPass.type === "password";
    loginPass.type = isPass ? "text" : "password";
    this.textContent = isPass ? "🙈" : "👁";
  });

  var loginBusy = false;
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (loginBusy) return;
    var u = loginUser.value.trim();
    var p = loginPass.value;
    loginError.hidden = true;

    if (!u || !p) {
      showLoginError("Preencha o e-mail e a palavra-passe.");
      return;
    }
    loginBusy = true;
    auth.signInWithEmailAndPassword(u, p).catch(function (err) {
      loginBusy = false;
      console.error("Erro de login:", err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        showLoginError("E-mail ou palavra-passe inválidos.");
      } else if (err.code === "auth/too-many-requests") {
        showLoginError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
      } else {
        showLoginError("Não foi possível iniciar sessão. Verifique a ligação à internet.");
      }
    });
  });

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.hidden = false;
  }

  function doLogout() {
    confirmDialog("Tem certeza que deseja sair do sistema?").then(function (ok) {
      if (!ok) return;
      auth.signOut();
    });
  }
  $("#logoutBtn").addEventListener("click", doLogout);

  function showLoginScreen() {
    $("#loginScreen").hidden = false;
    $("#validateScreen").hidden = true;
    $("#app").hidden = true;
    document.body.style.overflow = "";
  }

  // Fonte de verdade da sessão: Firebase Auth. Sempre que o estado de
  // autenticação muda (login, logout, ou reabrir a app já com sessão),
  // confirma-se a função (role) do utilizador na coleção "team".
  auth.onAuthStateChanged(function (fbUser) {
    loginBusy = false;
    var onValidateScreen = location.hash.indexOf("#/validar") === 0;
    if (!fbUser) {
      currentSession = null;
      if (!onValidateScreen) {
        history.replaceState(null, "", location.pathname + location.search + "#/login");
        showLoginScreen();
      }
      return;
    }
    teamColRef.doc(fbUser.uid).get().then(function (docSnap) {
      if (!docSnap.exists) {
        showLoginError("Esta conta não está associada a nenhum utilizador da equipa. Contacte o administrador.");
        auth.signOut();
        return;
      }
      var t = docSnap.data();
      if (t.estado === "Inativo") {
        showLoginError("Este utilizador está inativo. Contacte o administrador.");
        auth.signOut();
        return;
      }
      currentSession = { uid: fbUser.uid, user: t.email, nome: t.nome, role: t.funcao, ts: Date.now() };
      loginForm.reset();
      enterApp();
    }).catch(function (err) {
      console.error("Erro ao validar utilizador:", err);
      showLoginError("Não foi possível validar a conta. Tente novamente.");
      auth.signOut();
    });
  });

  function enterApp() {
    var user = getCurrentUser();
    if (!user) { showLoginScreen(); return; }
    $("#loginScreen").hidden = true;
    $("#validateScreen").hidden = true;
    $("#app").hidden = false;
    $("#topbarUser").textContent = user.nome + " · " + user.role;
    applyPermissions(user.role);
    if (!location.hash || location.hash === "#/login") {
      location.hash = "#/dashboard";
    }
    router();
  }

  function applyPermissions(role) {
    var allowed = PERMISSIONS[role] || ["dashboard"];
    $all(".nav-item").forEach(function (btn) {
      var route = btn.getAttribute("data-route");
      btn.hidden = allowed.indexOf(route) === -1;
    });
  }

  /* ---------------------------------------------------------
     6) ROTEAMENTO (hash-based)
     --------------------------------------------------------- */
  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, "");
    return h || "dashboard";
  }

  function router() {
    var h = location.hash;

    // Rota pública de validação de recibo — não exige sessão
    if (h.indexOf("#/validar") === 0) {
      var id = h.replace(/^#\/validar\/?/, "");
      renderValidateScreen(decodeURIComponent(id));
      return;
    }

    var user = getCurrentUser();
    if (!user) { showLoginScreen(); return; }

    // sessão válida — mostra o painel
    $("#loginScreen").hidden = true;
    $("#validateScreen").hidden = true;
    $("#app").hidden = false;

    var route = currentRoute();
    var allowed = PERMISSIONS[user.role] || ["dashboard"];
    if (allowed.indexOf(route) === -1) route = allowed[0] || "dashboard";

    $all(".view").forEach(function (v) { v.hidden = true; });
    var view = $("#view-" + route);
    if (view) view.hidden = false;

    $all(".nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-route") === route);
    });

    closeSidebar();

    if (route === "dashboard") renderDashboard();
    if (route === "encomendas") renderOrdersList();
    if (route === "clientes") renderClients();
    if (route === "equipa") renderTeam();
    if (route === "financeiro") renderFinance();
    if (route === "definicoes") renderSettings();
  }
  window.addEventListener("hashchange", router);

  // Reforça verificação de sessão ao voltar/avançar no navegador e ao restaurar do bfcache
  window.addEventListener("popstate", function () {
    if (!getCurrentUser() && location.hash.indexOf("#/validar") !== 0) {
      showLoginScreen();
    }
  });
  window.addEventListener("pageshow", function () {
    if (!getCurrentUser() && location.hash.indexOf("#/validar") !== 0) {
      showLoginScreen();
    }
  });

  /* ---------------------------------------------------------
     7) SIDEBAR (mobile)
     --------------------------------------------------------- */
  var sidebar = $("#sidebar"), sidebarOverlay = $("#sidebarOverlay");
  function openSidebar() { sidebar.classList.add("open"); sidebarOverlay.hidden = false; }
  function closeSidebar() { sidebar.classList.remove("open"); sidebarOverlay.hidden = true; }
  $("#menuToggle").addEventListener("click", openSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);
  $all(".nav-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      location.hash = "#/" + btn.getAttribute("data-route");
    });
  });

  /* ---------------------------------------------------------
     8) DASHBOARD
     --------------------------------------------------------- */
  function renderDashboard() {
    var orders = DB.orders;
    var entregues = orders.filter(function (o) { return o.estado === "ENTREGUE"; });
    var pendentes = orders.filter(function (o) { return o.estado === "PENDENTE"; });
    var totalGeral = orders.reduce(function (s, o) { return s + Number(o.custo || 0) + Number(o.taxi || 0); }, 0);

    $("#statEntregas").textContent = orders.length;
    $("#statEntregues").textContent = entregues.length;
    $("#statPendentes").textContent = pendentes.length;
    $("#statProdutos").textContent = orders.length;
    $("#statTotal").textContent = fmtKz(totalGeral);

    var todayStr = new Date().toISOString().slice(0, 10);
    var todays = orders.filter(function (o) { return o.data === todayStr; })
      .sort(function (a, b) { return (a.horario || "").localeCompare(b.horario || ""); });

    renderOrderCards($("#dashboardOrders"), todays, "Sem entregas agendadas para hoje.");
  }

  /* ---------------------------------------------------------
     9) ENCOMENDAS — LISTAGEM / FILTROS / PESQUISA
     --------------------------------------------------------- */
  var currentFilter = "TODOS";
  var currentSearch = "";

  $("#orderSearch").addEventListener("input", function () {
    currentSearch = this.value.trim().toLowerCase();
    renderOrdersList();
  });
  $all(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      $all(".chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      currentFilter = chip.getAttribute("data-filter");
      renderOrdersList();
    });
  });

  function filteredOrders() {
    return DB.orders.filter(function (o) {
      if (currentFilter !== "TODOS" && o.estado !== currentFilter) return false;
      if (!currentSearch) return true;
      var haystack = [o.cliente, o.produto, o.contacto, o.whatsapp, o.categoria, o.localizacao]
        .join(" ").toLowerCase();
      return haystack.indexOf(currentSearch) !== -1;
    }).sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
  }

  function renderOrdersList() {
    var list = filteredOrders();
    renderOrdersGroupedByDay($("#ordersList"), list);
  }

  var WEEKDAY_NAMES = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
  var MONTH_NAMES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  function formatDayHeader(dateStr) {
    if (!dateStr) return "Sem data definida";
    var parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    var label = WEEKDAY_NAMES[d.getDay()] + ", " + d.getDate() + " de " + MONTH_NAMES[d.getMonth()] + " de " + d.getFullYear();
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function renderOrdersGroupedByDay(container, list) {
    if (!list.length) {
      container.innerHTML = '<p style="color:#8a8f98;padding:14px 2px;">Nenhuma encomenda encontrada.</p>';
      return;
    }
    var groups = {};
    list.forEach(function (o) {
      var key = o.data || "sem-data";
      (groups[key] = groups[key] || []).push(o);
    });
    var dateKeys = Object.keys(groups).sort(function (a, b) {
      if (a === "sem-data") return 1;
      if (b === "sem-data") return -1;
      return b.localeCompare(a); // mais recente primeiro
    });

    container.innerHTML = dateKeys.map(function (key) {
      var n = groups[key].length;
      return '<div class="day-group">' +
        '<div class="day-header"><span>' + escapeHtml(formatDayHeader(key === "sem-data" ? "" : key)) + '</span>' +
        '<span class="day-count">' + n + (n === 1 ? " encomenda" : " encomendas") + "</span></div>" +
        '<div class="orders-grid" data-day-container="' + key + '"></div>' +
        "</div>";
    }).join("");

    dateKeys.forEach(function (key) {
      var dayContainer = container.querySelector('[data-day-container="' + key + '"]');
      var dayList = groups[key].sort(function (a, b) { return (a.horario || "").localeCompare(b.horario || ""); });
      renderOrderCards(dayContainer, dayList, "");
    });
  }

  function renderOrderCards(container, list, emptyMsg) {
    if (!list.length) {
      container.innerHTML = '<p style="color:#8a8f98;padding:14px 2px;">' + escapeHtml(emptyMsg) + "</p>";
      return;
    }
    container.innerHTML = list.map(function (o) {
      var total = Number(o.custo || 0) + Number(o.taxi || 0);
      return (
        '<div class="order-card" data-id="' + o.id + '">' +
          '<div class="order-card-top">' +
            '<div class="order-photo-wrap">' +
              '<img class="order-photo" data-photo-for="' + o.id + '" hidden alt="Foto do produto">' +
              '<div class="order-photo-placeholder" data-placeholder-for="' + o.id + '">📦</div>' +
              '<span class="order-photo-badge" data-badge-for="' + o.id + '" hidden></span>' +
            "</div>" +
            '<div class="order-info">' +
              '<span class="oname">' + escapeHtml(o.cliente) + "</span>" +
              '<span class="oproduct">' + escapeHtml(o.produto) + " · " + escapeHtml(o.categoria) + "</span>" +
              '<span class="order-badge ' + o.estado + '">' + o.estado + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="order-details">' +
            "<div><b>Contacto</b>" + escapeHtml(o.contacto || "—") + "</div>" +
            "<div><b>WhatsApp</b>" + escapeHtml(o.whatsapp || o.contacto || "—") + "</div>" +
            "<div><b>Horário</b>" + escapeHtml(o.horario || "—") + " · " + escapeHtml(o.data || "—") + "</div>" +
            "<div><b>Entrega</b>" + escapeHtml(o.entregaLocal || "—") + "</div>" +
            "<div><b>Valor produto</b>" + fmtKz(o.custo) + "</div>" +
            "<div><b>Táxi</b>" + fmtKz(o.taxi) + "</div>" +
            (o.registadoPor ? "<div><b>Registado por</b>" + escapeHtml(o.registadoPor.nome) + " (" + escapeHtml(o.registadoPor.funcao) + ")</div>" : "") +
            '<div class="full"><b>Total</b>' + fmtKz(total) + "</div>" +
          "</div>" +
          '<div class="order-actions">' +
            '<button class="btn btn-outline btn-sm" data-action="edit">✏️ Editar</button>' +
            '<button class="btn btn-outline btn-sm" data-action="receipt">🧾 Recibo</button>' +
            (o.estado === "PENDENTE"
              ? '<button class="btn btn-primary btn-sm" data-action="deliver">✅ Marcar entregue</button>'
              : '<button class="btn btn-outline btn-sm" data-action="reopen">↩️ Reabrir</button>') +
            (o.whatsapp || o.contacto ? '<button class="btn btn-outline btn-sm" data-action="whatsapp">🟢 WhatsApp</button>' : "") +
            (o.contacto ? '<button class="btn btn-outline btn-sm" data-action="call">📞 Ligar</button>' : "") +
            '<button class="btn btn-outline-danger btn-sm" data-action="delete">🗑️ Eliminar</button>' +
          "</div>" +
        "</div>"
      );
    }).join("");

    // carrega fotos assíncronas do Firebase Storage
    list.forEach(function (o) {
      loadOrderPhoto(o.id, container);
    });

    $all(".order-card", container).forEach(function (card) {
      var id = card.getAttribute("data-id");
      var order = DB.orders.find(function (o) { return o.id === id; });
      $all("[data-action]", card).forEach(function (btn) {
        btn.addEventListener("click", function () { handleOrderAction(btn.getAttribute("data-action"), order); });
      });
      var photoWrap = card.querySelector(".order-photo-wrap");
      if (photoWrap) {
        photoWrap.addEventListener("click", function () { openPhotoGallery(order); });
      }
    });
  }

  function openPhotoGallery(order) {
    getPhotos(order.id).then(function (images) {
      if (!images.length) { toast("Esta encomenda não tem fotos.", "error"); return; }
      $("#photoGalleryTitle").textContent = "Fotos — " + order.cliente + " (" + images.length + ")";
      $("#photoGalleryGrid").innerHTML = images.map(function (url, idx) {
        return '<img src="' + url + '" alt="Foto ' + (idx + 1) + ' de ' + order.produto + '">';
      }).join("");
      $("#photoGalleryModal").hidden = false;
    });
  }

  function loadOrderPhoto(orderId, container) {
    if (photoCache[orderId] !== undefined) {
      applyPhotoToCard(orderId, photoCache[orderId], container);
      return;
    }
    getPhotos(orderId).then(function (images) {
      photoCache[orderId] = images;
      applyPhotoToCard(orderId, images, container);
    });
  }
  function applyPhotoToCard(orderId, images, container) {
    images = images || [];
    var img = container.querySelector('[data-photo-for="' + orderId + '"]');
    var placeholder = container.querySelector('[data-placeholder-for="' + orderId + '"]');
    var badge = container.querySelector('[data-badge-for="' + orderId + '"]');
    if (!img) return;
    if (images[0]) {
      img.src = images[0]; img.hidden = false;
      if (placeholder) placeholder.hidden = true;
    }
    if (badge && images.length > 1) {
      badge.textContent = "+" + (images.length - 1);
      badge.hidden = false;
    }
  }

  function handleOrderAction(action, order) {
    if (!order) return;
    if (action === "edit") openOrderModal(order);
    if (action === "receipt") openReceipt(order);
    if (action === "deliver") setOrderStatus(order, "ENTREGUE");
    if (action === "reopen") setOrderStatus(order, "PENDENTE");
    if (action === "whatsapp") openWhatsApp(order.whatsapp || order.contacto, buildOrderMessage(order));
    if (action === "call") window.location.href = "tel:+" + normalizeAngolaPhone(order.contacto);
    if (action === "delete") deleteOrder(order);
  }

  function deleteOrder(order) {
    confirmDialog('Eliminar definitivamente a encomenda de "' + order.cliente + '" (' + order.produto + ')? Esta ação não pode ser desfeita.').then(function (ok) {
      if (!ok) return;
      DB.orders = DB.orders.filter(function (o) { return o.id !== order.id; });
      persist();
      deletePhoto(order.id);
      deleteReceiptSummary(order.id);
      delete photoCache[order.id];
      recalcClientPurchases();
      toast("Encomenda eliminada.", "success");
      router();
    });
  }

  function recalcClientPurchases() {
    DB.clients.forEach(function (c) {
      c.compras = DB.orders.filter(function (o) {
        return o.cliente.toLowerCase() === c.nome.toLowerCase() && (o.contacto || "") === (c.contacto || "");
      }).length;
    });
    persist();
  }

  function setOrderStatus(order, estado) {
    order.estado = estado;
    persist();
    saveReceiptSummary(order);
    toast(estado === "ENTREGUE" ? "Encomenda marcada como entregue." : "Encomenda reaberta.", "success");
    router();
  }

  /* ---------------------------------------------------------
     10) MODAL — NOVA / EDITAR ENCOMENDA
     --------------------------------------------------------- */
  var orderModal = $("#orderModal");
  var orderForm = $("#orderForm");
  var pendingPhotoDataUrls = []; // fotos selecionadas ainda não persistidas (máx. 5)
  var MAX_PHOTOS = 5;

  function renderFotoPreviewGrid() {
    var grid = $("#fotoPreviewGrid");
    grid.innerHTML = pendingPhotoDataUrls.map(function (url, idx) {
      return '<div class="foto-preview-item">' +
        '<img src="' + url + '" alt="Foto ' + (idx + 1) + '">' +
        '<button type="button" class="foto-preview-remove" data-remove-photo="' + idx + '">✕</button>' +
        "</div>";
    }).join("");
    $("#fotoCountLabel").textContent = "(" + pendingPhotoDataUrls.length + "/" + MAX_PHOTOS + ")";
    $all("[data-remove-photo]", grid).forEach(function (btn) {
      btn.addEventListener("click", function () {
        pendingPhotoDataUrls.splice(Number(btn.getAttribute("data-remove-photo")), 1);
        renderFotoPreviewGrid();
      });
    });
  }

  $("#newOrderBtn").addEventListener("click", function () { openOrderModal(null); });

  function openOrderModal(order) {
    orderForm.reset();
    pendingPhotoDataUrls = [];
    renderFotoPreviewGrid();
    $("#orderId").value = order ? order.id : "";
    $("#orderModalTitle").textContent = order ? "Editar encomenda #" + order.id : "Nova encomenda";

    if (order) {
      $("#f_cliente").value = order.cliente || "";
      $("#f_genero").value = order.genero || "";
      $("#f_contacto").value = order.contacto || "";
      $("#f_whatsapp").value = order.whatsapp || "";
      $("#f_localizacao").value = order.localizacao || "";
      $("#f_entrega_local").value = order.entregaLocal || "";
      $("#f_data").value = order.data || "";
      $("#f_horario").value = order.horario || "";
      $("#f_categoria").value = order.categoria || "";
      $("#f_produto").value = order.produto || "";
      $("#f_custo").value = order.custo || "";
      $("#f_taxi").value = order.taxi || "";
      $("#f_cor").value = order.cor || "";
      $("#f_tamanho").value = order.tamanho || "";
      $("#f_obs").value = order.observacoes || "";
      $("#f_autoriza").checked = !!order.autorizaNovidades;
      getPhotos(order.id).then(function (images) {
        if (images && images.length) {
          pendingPhotoDataUrls = images.slice(0, MAX_PHOTOS);
          renderFotoPreviewGrid();
        }
      });
    } else {
      var today = new Date().toISOString().slice(0, 10);
      $("#f_data").value = today;
    }
    toggleCategoryFields();
    updateTotalPreview();
    orderModal.hidden = false;
  }

  function toggleCategoryFields() {
    var isPerfume = $("#f_categoria").value === "Perfume";
    $("#fieldCor").style.opacity = isPerfume ? "0.6" : "1";
    $("#fieldTamanho").style.opacity = isPerfume ? "0.6" : "1";
    $("#perfumeHint").hidden = !isPerfume;
  }
  $("#f_categoria").addEventListener("change", toggleCategoryFields);

  function updateTotalPreview() {
    var custo = Number($("#f_custo").value) || 0;
    var taxi = Number($("#f_taxi").value) || 0;
    $("#f_totalPreview").textContent = fmtKz(custo + taxi);
  }
  $("#f_custo").addEventListener("input", updateTotalPreview);
  $("#f_taxi").addEventListener("input", updateTotalPreview);

  // Redimensiona e comprime cada foto para caber num documento Firestore
  // (limite de 1MB por documento, partilhado por até 5 fotos). Mantém
  // qualidade suficiente para o recibo.
  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = function () { reject(new Error("Não foi possível ler a imagem.")); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error("Não foi possível ler o ficheiro.")); };
      reader.readAsDataURL(file);
    });
  }

  function processOnePhoto(file) {
    // Tenta várias combinações até a imagem ficar bem abaixo do limite do
    // Firestore (repartido por até 5 fotos no mesmo documento).
    var HARD_CAP = 140 * 1024; // ~140KB por foto ⇒ 5 fotos ficam bem abaixo de 1MB
    var steps = [[900, 0.65], [700, 0.5], [520, 0.4], [400, 0.3], [320, 0.22]];
    function tryStep(i) {
      var s = steps[i];
      return compressImage(file, s[0], s[1]).then(function (dataUrl) {
        if (dataUrl.length <= HARD_CAP || i === steps.length - 1) return dataUrl;
        return tryStep(i + 1);
      });
    }
    return tryStep(0);
  }

  $("#f_foto").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var vagas = MAX_PHOTOS - pendingPhotoDataUrls.length;
    if (vagas <= 0) {
      toast("Já tem o máximo de " + MAX_PHOTOS + " fotos nesta encomenda.", "error");
      e.target.value = "";
      return;
    }
    if (files.length > vagas) {
      toast("Só é possível adicionar mais " + vagas + " foto(s). As restantes foram ignoradas.", "error");
      files = files.slice(0, vagas);
    }
    var tooBig = files.filter(function (f) { return f.size > 8 * 1024 * 1024; });
    if (tooBig.length) {
      toast("Uma ou mais imagens são maiores que 8MB e foram ignoradas.", "error");
      files = files.filter(function (f) { return f.size <= 8 * 1024 * 1024; });
    }
    Promise.all(files.map(processOnePhoto)).then(function (dataUrls) {
      pendingPhotoDataUrls = pendingPhotoDataUrls.concat(dataUrls);
      renderFotoPreviewGrid();
    }).catch(function (err) {
      console.error(err);
      toast("Não foi possível processar uma das fotos.", "error");
    }).finally(function () {
      e.target.value = "";
    });
  });

  orderForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var isPerfume = $("#f_categoria").value === "Perfume";

    if (!isPerfume) {
      if (!$("#f_cor").value.trim()) { toast("Indique a cor do produto.", "error"); $("#f_cor").focus(); return; }
      if (!$("#f_tamanho").value.trim()) { toast("Indique o tamanho do produto.", "error"); $("#f_tamanho").focus(); return; }
    }
    if (!pendingPhotoDataUrls.length) { toast("Pelo menos uma foto do produto é obrigatória.", "error"); return; }

    var id = $("#orderId").value;
    var isNew = !id;
    if (isNew) id = nextOrderId();

    var order = DB.orders.find(function (o) { return o.id === id; }) || {
      id: id, estado: "PENDENTE", criadoEm: Date.now()
    };

    if (isNew) {
      var quemCriou = getCurrentUser();
      order.registadoPor = quemCriou ? { nome: quemCriou.nome, funcao: quemCriou.role } : null;
    }

    order.cliente = $("#f_cliente").value.trim();
    order.genero = $("#f_genero").value;
    order.contacto = $("#f_contacto").value.trim();
    order.whatsapp = $("#f_whatsapp").value.trim();
    order.localizacao = $("#f_localizacao").value.trim();
    order.entregaLocal = $("#f_entrega_local").value.trim();
    order.data = $("#f_data").value;
    order.horario = $("#f_horario").value;
    order.categoria = $("#f_categoria").value;
    order.produto = $("#f_produto").value.trim();
    order.custo = Number($("#f_custo").value) || 0;
    order.taxi = Number($("#f_taxi").value) || 0;
    order.cor = isPerfume ? "" : $("#f_cor").value.trim();
    order.tamanho = isPerfume ? "" : $("#f_tamanho").value.trim();
    order.observacoes = $("#f_obs").value.trim();
    order.autorizaNovidades = $("#f_autoriza").checked;

    if (isNew) DB.orders.push(order);
    persist();
    saveReceiptSummary(order);

    upsertClientFromOrder(order);
    closeModal(orderModal);
    router();

    if (pendingPhotoDataUrls.length) {
      photoCache[id] = pendingPhotoDataUrls;
      toast(isNew ? "Encomenda criada. A guardar fotos…" : "Encomenda atualizada. A guardar fotos…");
      savePhoto(id, pendingPhotoDataUrls).then(function (result) {
        if (result.ok) {
          toast("Fotos guardadas com sucesso.", "success");
        } else {
          delete photoCache[id];
          console.error("Falha ao guardar fotos:", result.code, result.message);
          toast("Falha ao guardar fotos (" + (result.code || "erro") + "): " + (result.message || "desconhecido"), "error");
        }
      });
    } else {
      toast(isNew ? "Encomenda criada com sucesso." : "Encomenda atualizada.", "success");
    }
  });

  /* ---------------------------------------------------------
     11) CLIENTES
     --------------------------------------------------------- */
  function upsertClientFromOrder(order) {
    var key = (order.contacto || order.cliente || "").trim().toLowerCase();
    if (!key) return;
    var client = DB.clients.find(function (c) {
      return (c.contacto || "").trim().toLowerCase() === (order.contacto || "").trim().toLowerCase()
        && c.nome.toLowerCase() === order.cliente.toLowerCase();
    });
    if (!client) {
      client = { id: uid("cli"), nome: order.cliente, contacto: order.contacto, compras: 0, autoriza: false };
      DB.clients.push(client);
    }
    client.nome = order.cliente;
    client.contacto = order.contacto;
    client.autoriza = order.autorizaNovidades || client.autoriza;
    // recalcula número de compras com base nas encomendas atuais deste cliente
    client.compras = DB.orders.filter(function (o) {
      return o.cliente.toLowerCase() === client.nome.toLowerCase() && (o.contacto || "") === (client.contacto || "");
    }).length;
    persist();
  }

  var clientSearchTerm = "";
  $("#clientSearch").addEventListener("input", function () {
    clientSearchTerm = this.value.trim().toLowerCase();
    renderClients();
  });

  function renderClients() {
    var list = DB.clients
      .filter(function (c) { return !clientSearchTerm || (c.nome + " " + c.contacto).toLowerCase().indexOf(clientSearchTerm) !== -1; })
      .sort(function (a, b) { return b.compras - a.compras; });
    var tbody = $("#clientsTbody");
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#8a8f98;">Nenhum cliente registado.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (c) {
      return "<tr><td>" + escapeHtml(c.nome) + "</td><td>" + escapeHtml(c.contacto || "—") + "</td><td>" +
        c.compras + "</td><td>" + (c.autoriza ? "✅ Sim" : "❌ Não") + "</td></tr>";
    }).join("");
  }

  /* ---------------------------------------------------------
     12) EQUIPA
     --------------------------------------------------------- */
  var userModal = $("#userModal");
  var userForm = $("#userForm");

  $("#newUserBtn").addEventListener("click", function () { openUserModal(null); });

  function openUserModal(member) {
    userForm.reset();
    $("#u_id").value = member ? member.id : "";
    $("#userModalTitle").textContent = member ? "Editar utilizador" : "Novo utilizador";
    $("#u_passHint").textContent = member
      ? "O e-mail de acesso não pode ser alterado aqui. Use \"Reenviar acesso\" na lista para redefinir a palavra-passe."
      : "A pessoa recebe um e-mail para definir a sua própria palavra-passe.";
    $("#u_user").disabled = !!member;
    if (member) {
      $("#u_nome").value = member.nome;
      $("#u_user").value = member.user;
      $("#u_funcao").value = member.funcao;
      $("#u_estado").value = member.estado;
    } else {
      $("#u_estado").value = "Ativo";
    }
    userModal.hidden = false;
  }

  function renderTeam() {
    var tbody = $("#teamTbody");
    var me = getCurrentUser();
    tbody.innerHTML = DB.team.map(function (m) {
      var isSelf = me && me.uid === m.id;
      return "<tr><td>" + escapeHtml(m.nome) + "</td><td>" + escapeHtml(m.email) + "</td><td>" + escapeHtml(m.funcao) +
        "</td><td>" + escapeHtml(m.estado) + '</td><td class="row-actions">' +
        '<button class="btn btn-outline btn-sm" data-edit="' + m.id + '">Editar</button>' +
        '<button class="btn btn-outline btn-sm" data-reset="' + m.id + '">Reenviar acesso</button>' +
        (isSelf ? "" : '<button class="btn btn-outline btn-sm" data-del="' + m.id + '">Remover</button>') +
        "</td></tr>";
    }).join("");
    $all("[data-edit]", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = DB.team.find(function (t) { return t.id === btn.getAttribute("data-edit"); });
        openUserModal(m);
      });
    });
    $all("[data-reset]", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = DB.team.find(function (t) { return t.id === btn.getAttribute("data-reset"); });
        auth.sendPasswordResetEmail(m.email).then(function () {
          toast("E-mail de definição de palavra-passe enviado a " + m.email + ".", "success");
        }).catch(function (err) {
          console.error(err);
          toast("Não foi possível enviar o e-mail.", "error");
        });
      });
    });
    $all("[data-del]", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = DB.team.find(function (t) { return t.id === btn.getAttribute("data-del"); });
        confirmDialog('Remover o utilizador "' + m.nome + '"? Isto retira o acesso à app. (A conta continua a existir no Firebase Authentication — para a apagar totalmente, remova-a também na consola Firebase.)').then(function (ok) {
          if (!ok) return;
          teamColRef.doc(m.id).delete().then(function () {
            toast("Utilizador removido.", "success");
          }).catch(function (err) {
            console.error(err);
            toast("Não foi possível remover o utilizador.", "error");
          });
        });
      });
    });
  }

  userForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var id = $("#u_id").value;
    var isNew = !id;
    var nomeVal = $("#u_nome").value.trim();
    var emailVal = $("#u_user").value.trim().toLowerCase();
    var funcaoVal = $("#u_funcao").value;
    var estadoVal = $("#u_estado").value;
    var submitBtn = userForm.querySelector('button[type="submit"]');

    if (!isNew) {
      // Apenas atualiza os dados do perfil (nome, função, estado) no Firestore.
      teamColRef.doc(id).update({ nome: nomeVal, funcao: funcaoVal, estado: estadoVal }).then(function () {
        closeModal(userModal);
        toast("Utilizador atualizado.", "success");
      }).catch(function (err) {
        console.error(err);
        toast("Não foi possível atualizar o utilizador.", "error");
      });
      return;
    }

    var dupe = DB.team.find(function (t) { return t.email.toLowerCase() === emailVal; });
    if (dupe) { toast("Já existe um utilizador com este e-mail.", "error"); return; }

    if (submitBtn) submitBtn.disabled = true;
    var tempPassword = "Mb" + Math.random().toString(36).slice(2, 10) + "!9";

    secondaryAuth.createUserWithEmailAndPassword(emailVal, tempPassword).then(function (cred) {
      var newUid = cred.user.uid;
      return teamColRef.doc(newUid).set({
        nome: nomeVal, email: emailVal, funcao: funcaoVal, estado: estadoVal
      }).then(function () {
        return auth.sendPasswordResetEmail(emailVal);
      }).then(function () {
        return secondaryAuth.signOut();
      });
    }).then(function () {
      closeModal(userModal);
      toast("Utilizador criado. Foi enviado um e-mail para " + emailVal + " definir a palavra-passe.", "success");
    }).catch(function (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        toast("Este e-mail já tem uma conta Firebase — associe-o manualmente na coleção \"team\".", "error");
      } else if (err.code === "auth/invalid-email") {
        toast("E-mail inválido.", "error");
      } else {
        toast("Não foi possível criar o utilizador.", "error");
      }
    }).finally(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
  });

  /* ---------------------------------------------------------
     13) FINANCEIRO
     --------------------------------------------------------- */
  function renderFinance() {
    var orders = DB.orders;
    var totalProdutos = orders.reduce(function (s, o) { return s + Number(o.custo || 0); }, 0);
    var totalTaxi = orders.reduce(function (s, o) { return s + Number(o.taxi || 0); }, 0);
    $("#finTotalGeral").textContent = fmtKz(totalProdutos + totalTaxi);
    $("#finTotalProdutos").textContent = fmtKz(totalProdutos);
    $("#finTotalTaxi").textContent = fmtKz(totalTaxi);
    $("#finNumEncomendas").textContent = orders.length;

    var byStatus = { PENDENTE: { n: 0, total: 0 }, ENTREGUE: { n: 0, total: 0 } };
    orders.forEach(function (o) {
      var t = Number(o.custo || 0) + Number(o.taxi || 0);
      if (!byStatus[o.estado]) byStatus[o.estado] = { n: 0, total: 0 };
      byStatus[o.estado].n++; byStatus[o.estado].total += t;
    });
    $("#finStatusTbody").innerHTML = Object.keys(byStatus).map(function (k) {
      return "<tr><td>" + k + "</td><td>" + byStatus[k].n + "</td><td>" + fmtKz(byStatus[k].total) + "</td></tr>";
    }).join("");
  }

  /* ---------------------------------------------------------
     14) RECIBO A4 + QR CODE
     --------------------------------------------------------- */
  var receiptModal = $("#receiptModal");
  var currentReceiptOrder = null;

  function openReceipt(order) {
    currentReceiptOrder = order;
    var total = Number(order.custo || 0) + Number(order.taxi || 0);
    var validateUrl = buildValidateUrl(order.id);

    $("#receiptA4").innerHTML =
      '<div class="receipt-head"><h2>' + escapeHtml((DB.settings && DB.settings.nome) || "MAMBEMBA BUSINESS") +
      '</h2><p>' + escapeHtml((DB.settings && DB.settings.slogan) || "Cuidamos do teu estilo.") + '</p></div>' +
      receiptRow("Nº Encomenda", order.id) +
      receiptRow("Cliente", order.cliente) +
      receiptRow("Contacto", order.contacto) +
      receiptRow("Produto", order.produto) +
      receiptRow("Categoria", order.categoria) +
      (order.cor ? receiptRow("Cor", order.cor) : "") +
      (order.tamanho ? receiptRow("Tamanho", order.tamanho) : "") +
      receiptRow("Local de entrega", order.entregaLocal) +
      receiptRow("Data", order.data) +
      receiptRow("Horário", order.horario) +
      receiptRow("Custo do produto", fmtKz(order.custo)) +
      receiptRow("Táxi", fmtKz(order.taxi)) +
      receiptRow("Estado", '<span class="receipt-status ' + (order.estado === "ENTREGUE" ? "order-badge ENTREGUE" : "order-badge PENDENTE") + '">' + order.estado + "</span>") +
      '<div class="receipt-total"><span>TOTAL</span><span>' + fmtKz(total) + "</span></div>" +
      '<div class="receipt-qr"><canvas id="receiptQrCanvas"></canvas>' +
      "<small>Aponte a câmera</small></div>";

    receiptModal.hidden = false;

    try {
      var canvas = $("#receiptQrCanvas");
      MBQRCode.renderToCanvas(canvas, validateUrl, { size: 180, dark: "#111111", light: "#ffffff" });
    } catch (err) {
      console.error("Falha ao gerar QR code:", err);
      var qrWrap = $(".receipt-qr");
      if (qrWrap) qrWrap.innerHTML = "<small>Código QR indisponível — use o ID do recibo (" + escapeHtml(order.id) + ") para validação manual.</small>";
    }
  }

  function receiptRow(label, value) {
    return '<div class="receipt-row"><b>' + escapeHtml(label) + "</b><span>" + (typeof value === "string" && value.indexOf("<span") === 0 ? value : escapeHtml(value)) + "</span></div>";
  }

  function buildValidateUrl(orderId) {
    var base = location.origin + location.pathname;
    return base + "#/validar/" + orderId;
  }

  $("#printReceiptBtn").addEventListener("click", function () { window.print(); });
  $("#downloadReceiptBtn").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    var order = currentReceiptOrder;
    toast("A preparar o PDF do recibo…");
    buildReceiptPdfBlob(order).then(function (blob) {
      downloadBlob(blob, "recibo-" + order.id + ".pdf");
      toast("PDF descarregado.", "success");
    }).catch(function (err) {
      console.error("Erro ao gerar PDF do recibo:", err);
      toast("Não foi possível gerar o PDF do recibo.", "error");
    });
  });

  /* ---------------------------------------------------------
     14b) DEFINIÇÕES — marca, cópia de segurança, apagar dados
     --------------------------------------------------------- */
  function renderSettings() {
    var user = getCurrentUser();
    var isAdminOrGestor = user && (user.role === "Admin" || user.role === "Gestor");

    $("#settingsBrandCard").hidden = !isAdminOrGestor;
    $("#settingsBackupCard").hidden = !isAdminOrGestor;
    $("#settingsDangerCard").hidden = !isAdminOrGestor;
    $("#settingsPageTitle").textContent = isAdminOrGestor ? "Definições" : "Aparência";

    $("#cfg_nome").value = (DB.settings && DB.settings.nome) || "MAMBEMBA BUSINESS";
    $("#cfg_slogan").value = (DB.settings && DB.settings.slogan) || "Cuidamos do teu estilo.";
    var current = getThemePref();
    var radio = document.querySelector('input[name="tema"][value="' + current + '"]');
    if (radio) radio.checked = true;
  }

  $all('input[name="tema"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (radio.checked) setThemePref(radio.value);
    });
  });

  $("#saveBrandBtn").addEventListener("click", function () {
    DB.settings = DB.settings || {};
    DB.settings.nome = $("#cfg_nome").value.trim() || "MAMBEMBA BUSINESS";
    DB.settings.slogan = $("#cfg_slogan").value.trim() || "Cuidamos do teu estilo.";
    persist();
    applyBranding();
    toast("Dados da loja atualizados.", "success");
  });

  // Nota: a partir da v3.3 os dados vivem no Firebase (Firestore + Storage),
  // sincronizados entre todos os dispositivos. Esta cópia de segurança
  // continua útil como proteção extra (ex.: apagar por engano), mas deixa
  // de ser a única fonte dos dados.
  $("#exportDataBtn").addEventListener("click", function () {
    var photoJobs = DB.orders.map(function (o) {
      return getPhotos(o.id).then(function (images) { return { id: o.id, images: images }; });
    });
    Promise.all(photoJobs).then(function (photos) {
      var exportObj = {
        version: "3.3",
        exportedAt: new Date().toISOString(),
        data: { orders: DB.orders, clients: DB.clients, settings: DB.settings, seq: DB.seq },
        photos: photos.filter(function (p) { return p.images && p.images.length; })
      };
      var blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "mambemba-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("Cópia de segurança exportada.", "success");
    });
  });

  $("#importDataInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var imported;
      try {
        imported = JSON.parse(reader.result);
        if (!imported || !imported.data || !Array.isArray(imported.data.orders)) throw new Error("formato inválido");
      } catch (err) {
        toast("Ficheiro inválido. Escolha um backup exportado por este sistema.", "error");
        e.target.value = "";
        return;
      }
      confirmDialog("Importar este ficheiro vai substituir TODOS os dados atuais (encomendas, clientes, definições) para TODOS os dispositivos ligados. Continuar?").then(function (ok) {
        e.target.value = "";
        if (!ok) return;
        DB.orders = imported.data.orders || [];
        DB.clients = imported.data.clients || [];
        DB.settings = imported.data.settings || clone(DEFAULT_DATA.settings);
        DB.seq = typeof imported.data.seq === "number" ? imported.data.seq : DB.orders.length;
        persist();
        var photoWrites = (imported.photos || []).map(function (p) {
          var images = p.images || (p.dataUrl ? [p.dataUrl] : []); // compatível com backups antigos (1 foto só)
          return savePhoto(p.id, images);
        });
        Promise.all(photoWrites).then(function () {
          applyBranding();
          toast("Dados importados com sucesso.", "success");
          router();
        });
      });
    };
    reader.readAsText(file);
  });

  $("#resetDataBtn").addEventListener("click", function () {
    confirmDialog("Isto vai apagar PERMANENTEMENTE todas as encomendas, clientes e fotos para TODOS os dispositivos ligados. A equipa e as definições da loja são mantidas. Continuar?").then(function (ok) {
      if (!ok) return;
      var photoDeletes = DB.orders.map(function (o) { return deletePhoto(o.id); });
      DB.orders = [];
      DB.clients = [];
      DB.seq = 0;
      persist();
      photoCache = {};
      Promise.all(photoDeletes).then(function () {
        toast("Todos os dados foram apagados.", "success");
        router();
      });
    });
  });

  /* ---------------------------------------------------------
     15) VALIDAÇÃO PÚBLICA DE RECIBO (via QR / link)
     --------------------------------------------------------- */
  function renderValidateScreen(orderId) {
    $("#loginScreen").hidden = true;
    $("#app").hidden = true;
    $("#validateScreen").hidden = false;
    // O botão só faz sentido para um membro da equipa que já tenha sessão
    // iniciada neste dispositivo — um cliente externo não deve ver isto.
    $("#validateBackBtn").hidden = !getCurrentUser();

    var body = $("#validateBody");
    body.innerHTML = "<p>A verificar recibo…</p>";

    receiptsColRef.doc(orderId).get().then(function (docSnap) {
      if (!docSnap.exists) {
        body.innerHTML = "<p>Nenhum recibo com o ID <b>" + escapeHtml(orderId || "—") +
          "</b> foi encontrado. Verifique se o código foi escaneado corretamente.</p>";
        return;
      }
      var r = docSnap.data();
      body.innerHTML =
        vrow("ID", orderId) +
        vrow("Produto", r.produto) +
        vrow("Categoria", r.categoria) +
        vrow("Data", r.data) +
        vrow("Horário", r.horario) +
        vrow("Total", fmtKz(r.total)) +
        '<div class="vrow"><b>Estado</b><span class="validate-status ' + (r.estado === "ENTREGUE" ? "order-badge ENTREGUE" : "order-badge PENDENTE") + '">' + r.estado + "</span></div>" +
        '<p class="field-hint" style="margin-top:14px;">Por privacidade, os dados do cliente não são mostrados nesta validação pública.</p>';
    }).catch(function (err) {
      console.error("Erro ao validar recibo:", err);
      body.innerHTML = "<p>Não foi possível validar o recibo agora. Verifique a ligação à internet e tente novamente.</p>";
    });
  }
  function vrow(label, value) {
    return '<div class="vrow"><b>' + escapeHtml(label) + "</b><span>" + escapeHtml(value) + "</span></div>";
  }
  $("#validateBackBtn").addEventListener("click", function (e) {
    e.preventDefault();
    location.hash = getCurrentUser() ? "#/dashboard" : "#/login";
  });

  /* ---------------------------------------------------------
     15b) RECIBO EM PDF (gerado localmente, sem serviços externos)
     --------------------------------------------------------- */
  var PDF_PAGE_W_PT = 595; // A4 em pontos
  var PDF_PAGE_H_PT = 842;

  function drawReceiptCanvas(order) {
    return new Promise(function (resolve) {
      var scale = 2;
      var W = PDF_PAGE_W_PT * scale, H = PDF_PAGE_H_PT * scale;
      var canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);

      var margin = 48 * scale;
      var y = margin;

      ctx.textAlign = "center";
      ctx.fillStyle = "#b40018";
      ctx.font = "bold " + (26 * scale) + "px Arial, sans-serif";
      ctx.fillText((DB.settings && DB.settings.nome) || "MAMBEMBA BUSINESS", W / 2, y + 24 * scale);
      y += 34 * scale;
      ctx.fillStyle = "#6b7280";
      ctx.font = (11 * scale) + "px Arial, sans-serif";
      ctx.fillText((DB.settings && DB.settings.slogan) || "Cuidamos do teu estilo.", W / 2, y);
      y += 16 * scale;

      ctx.strokeStyle = "#b40018"; ctx.lineWidth = 3 * scale;
      ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(W - margin, y); ctx.stroke();
      y += 30 * scale;

      var total = Number(order.custo || 0) + Number(order.taxi || 0);
      var rows = [
        ["Nº Encomenda", order.id],
        ["Cliente", order.cliente],
        ["Contacto", order.contacto],
        ["Produto", order.produto],
        ["Categoria", order.categoria]
      ];
      if (order.cor) rows.push(["Cor", order.cor]);
      if (order.tamanho) rows.push(["Tamanho", order.tamanho]);
      rows.push(["Local de entrega", order.entregaLocal]);
      rows.push(["Data", order.data]);
      rows.push(["Horário", order.horario]);
      rows.push(["Custo do produto", fmtKz(order.custo)]);
      rows.push(["Táxi", fmtKz(order.taxi)]);
      rows.push(["Estado", order.estado]);

      rows.forEach(function (r) {
        ctx.textAlign = "left";
        ctx.fillStyle = "#555555";
        ctx.font = "bold " + (12 * scale) + "px Arial, sans-serif";
        ctx.fillText(String(r[0]), margin, y);
        ctx.textAlign = "right";
        ctx.fillStyle = "#111111";
        ctx.font = (12 * scale) + "px Arial, sans-serif";
        ctx.fillText(String(r[1] || "—"), W - margin, y);

        ctx.strokeStyle = "#e3e5ea"; ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(margin, y + 8 * scale); ctx.lineTo(W - margin, y + 8 * scale); ctx.stroke();
        ctx.setLineDash([]);
        y += 26 * scale;
      });

      y += 8 * scale;
      ctx.strokeStyle = "#111111"; ctx.lineWidth = 2 * scale;
      ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(W - margin, y); ctx.stroke();
      y += 32 * scale;

      ctx.textAlign = "left";
      ctx.fillStyle = "#111111";
      ctx.font = "bold " + (18 * scale) + "px Arial, sans-serif";
      ctx.fillText("TOTAL", margin, y);
      ctx.textAlign = "right";
      ctx.fillText(fmtKz(total), W - margin, y);
      y += 50 * scale;

      var qrSize = 190 * scale;
      var qrCanvas = document.createElement("canvas");
      try {
        MBQRCode.renderToCanvas(qrCanvas, buildValidateUrl(order.id), { size: qrSize, dark: "#111111", light: "#ffffff" });
      } catch (err) { console.error("Falha ao gerar QR no PDF:", err); }
      var qrX = (W - qrCanvas.width) / 2;
      ctx.drawImage(qrCanvas, qrX, y);
      y += qrCanvas.height + 20 * scale;

      ctx.textAlign = "center";
      ctx.fillStyle = "#6b7280";
      ctx.font = (11 * scale) + "px Arial, sans-serif";
      ctx.fillText("Aponte a câmera", W / 2, y);

      resolve(canvas);
    });
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Constrói um PDF válido de página única embutindo diretamente uma imagem JPEG,
  // sem depender de nenhuma biblioteca externa (funciona 100% offline).
  function buildSingleImagePdf(jpegDataUrl, imgW, imgH, pageWpt, pageHpt) {
    var jpegBytes = base64ToBytes(jpegDataUrl.split(",")[1]);
    var enc = new TextEncoder();
    var parts = []; var pos = 0; var offsets = {};
    function add(x) {
      var bytes = (typeof x === "string") ? enc.encode(x) : x;
      parts.push(bytes); pos += bytes.length;
    }
    add("%PDF-1.4\n");

    offsets[1] = pos;
    add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    offsets[2] = pos;
    add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    offsets[3] = pos;
    add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageWpt + " " + pageHpt +
      "] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");

    var content = "q " + pageWpt.toFixed(2) + " 0 0 " + pageHpt.toFixed(2) + " 0 0 cm /Im0 Do Q";
    offsets[4] = pos;
    add("4 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream\nendobj\n");

    offsets[5] = pos;
    add("5 0 obj\n<< /Type /XObject /Subtype /Image /Width " + imgW + " /Height " + imgH +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpegBytes.length + " >>\nstream\n");
    add(jpegBytes);
    add("\nendstream\nendobj\n");

    var xrefStart = pos;
    var xref = "xref\n0 6\n0000000000 65535 f \n";
    for (var i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    add(xref);
    add("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF");

    var full = new Uint8Array(pos);
    var offset = 0;
    parts.forEach(function (p) { full.set(p, offset); offset += p.length; });
    return new Blob([full], { type: "application/pdf" });
  }

  function buildReceiptPdfBlob(order) {
    return drawReceiptCanvas(order).then(function (canvas) {
      var dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      return buildSingleImagePdf(dataUrl, canvas.width, canvas.height, PDF_PAGE_W_PT, PDF_PAGE_H_PT);
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ---------------------------------------------------------
     16) PARTILHA (WhatsApp / E-mail / SMS)
     --------------------------------------------------------- */
  var shareModal = $("#shareModal");
  $("#shareReceiptBtn").addEventListener("click", function () { shareModal.hidden = false; });

  function buildOrderMessage(order) {
    var total = Number(order.custo || 0) + Number(order.taxi || 0);
    var nome = (DB.settings && DB.settings.nome) || "MAMBEMBA BUSINESS";
    return nome + "\n" +
      "Recibo: " + order.id + "\n" +
      "Cliente: " + order.cliente + "\n" +
      "Produto: " + order.produto + "\n" +
      "Total: " + fmtKz(total) + "\n" +
      "Validação: " + buildValidateUrl(order.id);
  }

  function openWhatsApp(phone, message) {
    var num = normalizeAngolaPhone(phone);
    var url = "https://wa.me/" + num + (message ? "?text=" + encodeURIComponent(message) : "");
    window.open(url, "_blank");
  }

  function shareReceiptPdf(order) {
    toast("A preparar o PDF do recibo…");
    return buildReceiptPdfBlob(order).then(function (blob) {
      var filename = "recibo-" + order.id + ".pdf";
      var file;
      try { file = new File([blob], filename, { type: "application/pdf" }); } catch (e) { file = null; }

      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({
          files: [file],
          title: "Recibo " + ((DB.settings && DB.settings.nome) || "Mambemba Business") + " — " + order.id,
          text: buildOrderMessage(order)
        }).catch(function () { /* utilizador cancelou a partilha — sem erro a reportar */ });
      }
      // Este navegador não suporta anexar ficheiros à partilha (ex.: WebView antigo):
      // descarrega o PDF para o utilizador anexar manualmente.
      downloadBlob(blob, filename);
      toast("O PDF foi descarregado — anexe-o manualmente na conversa.", "error");
      return Promise.resolve();
    }).catch(function (err) {
      console.error("Erro ao gerar PDF do recibo:", err);
      toast("Não foi possível gerar o PDF do recibo.", "error");
    });
  }

  $("#shareWhatsapp").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    shareModal.hidden = true;
    shareReceiptPdf(currentReceiptOrder);
  });
  $("#shareEmail").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    shareModal.hidden = true;
    shareReceiptPdf(currentReceiptOrder);
  });
  $("#shareSms").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    var body = buildOrderMessage(currentReceiptOrder);
    window.location.href = "sms:?body=" + encodeURIComponent(body);
    shareModal.hidden = true;
  });

  /* ---------------------------------------------------------
     17) MODAIS — abrir/fechar genérico
     --------------------------------------------------------- */
  function closeModal(modal) { modal.hidden = true; }
  $all("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.closest(".modal-overlay"));
    });
  });
  $all(".modal-overlay").forEach(function (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  /* ---------------------------------------------------------
     18) ARRANQUE
     --------------------------------------------------------- */
  function boot() {
    if (location.hash.indexOf("#/validar") === 0) {
      router();
      return;
    }
    var user = getCurrentUser();
    if (user) {
      enterApp();
    } else {
      showLoginScreen();
      if (location.hash && location.hash !== "#/login") history.replaceState(null, "", location.pathname + location.search + "#/login");
    }
  }

  var booted = false;
  function bootOnce() { if (booted) return; booted = true; boot(); }
  document.addEventListener("DOMContentLoaded", bootOnce);
  if (document.readyState === "complete" || document.readyState === "interactive") bootOnce();

})();
