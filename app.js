/* ============================================================
   MAMBEMBA BUSINESS — v3.2 — app.js
   Aplicação 100% estática (HTML + CSS + JS puro).
   Persistência: LocalStorage (dados/sessão) + IndexedDB (fotos).
   Sem backend, sem API externa, sem servidor.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     1) CONSTANTES E CHAVES
     --------------------------------------------------------- */
  var DATA_KEY = "mb_v32_data";
  var SESSION_KEY = "mb_v32_session";
  var DB_NAME = "mb_v32_photos_db";
  var DB_STORE = "photos";

  var PERMISSIONS = {
    "Admin":      ["dashboard", "encomendas", "clientes", "equipa", "financeiro"],
    "Gestor":     ["dashboard", "encomendas", "clientes", "equipa", "financeiro"],
    "Vendedor":   ["dashboard", "encomendas", "clientes"],
    "Entregador": ["dashboard", "encomendas"],
    "Financeiro": ["dashboard", "financeiro"]
  };

  var DEFAULT_DATA = {
    orders: [],
    clients: [],
    team: [
      { id: "u_admin", nome: "Administrador", user: "Admin", pass: "03052000", funcao: "Admin", estado: "Ativo" }
    ],
    seq: 0
  };

  /* ---------------------------------------------------------
     2) PERSISTÊNCIA — LocalStorage
     --------------------------------------------------------- */
  function loadData() {
    try {
      var raw = localStorage.getItem(DATA_KEY);
      if (!raw) { saveData(DEFAULT_DATA); return clone(DEFAULT_DATA); }
      var parsed = JSON.parse(raw);
      if (!parsed.team || !parsed.team.length) parsed.team = clone(DEFAULT_DATA.team);
      if (!parsed.orders) parsed.orders = [];
      if (!parsed.clients) parsed.clients = [];
      if (typeof parsed.seq !== "number") parsed.seq = parsed.orders.length;
      return parsed;
    } catch (e) {
      console.error("Erro ao carregar dados:", e);
      return clone(DEFAULT_DATA);
    }
  }
  function saveData(data) {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error("Erro ao guardar dados:", e);
      toast("Não foi possível guardar (armazenamento cheio).", "error");
      return false;
    }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function getCurrentUser() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  var DB = clone(DEFAULT_DATA); // in-memory working copy, synced with localStorage
  DB = loadData();

  function persist() { saveData(DB); }

  /* ---------------------------------------------------------
     3) PERSISTÊNCIA — IndexedDB (fotos dos produtos)
     --------------------------------------------------------- */
  var idbPromise = null;
  function openPhotoDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return idbPromise;
  }
  function savePhoto(orderId, dataUrl) {
    return openPhotoDB().then(function (db) {
      if (!db) { try { localStorage.setItem("mb_v32_photo_" + orderId, dataUrl); } catch (e) {} return; }
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(dataUrl, orderId);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }
  function getPhoto(orderId) {
    return openPhotoDB().then(function (db) {
      if (!db) { return localStorage.getItem("mb_v32_photo_" + orderId); }
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(orderId);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    });
  }
  function deletePhoto(orderId) {
    return openPhotoDB().then(function (db) {
      if (!db) { localStorage.removeItem("mb_v32_photo_" + orderId); return; }
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(orderId);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }
  var photoCache = {}; // orderId -> dataURL, populated lazily for rendering

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

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var u = loginUser.value.trim();
    var p = loginPass.value;
    loginError.hidden = true;

    if (!u || !p) {
      showLoginError("Preencha o utilizador e a palavra-passe.");
      return;
    }
    var match = DB.team.find(function (t) {
      return t.user.toLowerCase() === u.toLowerCase() && t.pass === p;
    });
    if (!match) {
      showLoginError("Utilizador ou palavra-passe inválidos.");
      return;
    }
    if (match.estado === "Inativo") {
      showLoginError("Este utilizador está inativo. Contacte o administrador.");
      return;
    }
    setSession({ id: match.id, user: match.user, nome: match.nome, role: match.funcao, ts: Date.now() });
    loginForm.reset();
    enterApp();
  });

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.hidden = false;
  }

  function doLogout() {
    confirmDialog("Tem certeza que deseja sair do sistema?").then(function (ok) {
      if (!ok) return;
      clearSession();
      history.replaceState(null, "", location.pathname + location.search + "#/login");
      showLoginScreen();
    });
  }
  $("#logoutBtn").addEventListener("click", doLogout);

  function showLoginScreen() {
    $("#loginScreen").hidden = false;
    $("#validateScreen").hidden = true;
    $("#app").hidden = true;
    document.body.style.overflow = "";
  }

  function enterApp() {
    var user = getCurrentUser();
    if (!user) { showLoginScreen(); return; }
    $("#loginScreen").hidden = true;
    $("#validateScreen").hidden = true;
    $("#app").hidden = false;
    $("#topbarUser").textContent = user.nome + " · " + user.role;
    applyPermissions(user.role);
    if (!location.hash || location.hash === "#/login" || location.hash.indexOf("#/validar") === 0) {
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
    renderOrderCards($("#ordersList"), list, "Nenhuma encomenda encontrada.");
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
            '<img class="order-photo" data-photo-for="' + o.id + '" hidden alt="Foto do produto">' +
            '<div class="order-photo-placeholder" data-placeholder-for="' + o.id + '">📦</div>' +
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
          "</div>" +
        "</div>"
      );
    }).join("");

    // carrega fotos assíncronas do IndexedDB
    list.forEach(function (o) {
      loadOrderPhoto(o.id, container);
    });

    $all(".order-card", container).forEach(function (card) {
      var id = card.getAttribute("data-id");
      var order = DB.orders.find(function (o) { return o.id === id; });
      $all("[data-action]", card).forEach(function (btn) {
        btn.addEventListener("click", function () { handleOrderAction(btn.getAttribute("data-action"), order); });
      });
    });
  }

  function loadOrderPhoto(orderId, container) {
    if (photoCache[orderId] !== undefined) {
      applyPhotoToCard(orderId, photoCache[orderId], container);
      return;
    }
    getPhoto(orderId).then(function (dataUrl) {
      photoCache[orderId] = dataUrl;
      applyPhotoToCard(orderId, dataUrl, container);
    });
  }
  function applyPhotoToCard(orderId, dataUrl, container) {
    var img = container.querySelector('[data-photo-for="' + orderId + '"]');
    var placeholder = container.querySelector('[data-placeholder-for="' + orderId + '"]');
    if (!img) return;
    if (dataUrl) {
      img.src = dataUrl; img.hidden = false;
      if (placeholder) placeholder.hidden = true;
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
  }

  function setOrderStatus(order, estado) {
    order.estado = estado;
    persist();
    toast(estado === "ENTREGUE" ? "Encomenda marcada como entregue." : "Encomenda reaberta.", "success");
    router();
  }

  /* ---------------------------------------------------------
     10) MODAL — NOVA / EDITAR ENCOMENDA
     --------------------------------------------------------- */
  var orderModal = $("#orderModal");
  var orderForm = $("#orderForm");
  var pendingPhotoDataUrl = null; // foto selecionada ainda não persistida

  $("#newOrderBtn").addEventListener("click", function () { openOrderModal(null); });

  function openOrderModal(order) {
    orderForm.reset();
    pendingPhotoDataUrl = null;
    $("#fotoPreview").hidden = true;
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
      getPhoto(order.id).then(function (dataUrl) {
        if (dataUrl) { $("#fotoPreview").src = dataUrl; $("#fotoPreview").hidden = false; pendingPhotoDataUrl = dataUrl; }
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
    $("#f_cor").required = false;
    $("#f_tamanho").required = false;
    $("#fieldCor").style.opacity = isPerfume ? "0.6" : "1";
    $("#fieldTamanho").style.opacity = isPerfume ? "0.6" : "1";
  }
  $("#f_categoria").addEventListener("change", toggleCategoryFields);

  function updateTotalPreview() {
    var custo = Number($("#f_custo").value) || 0;
    var taxi = Number($("#f_taxi").value) || 0;
    $("#f_totalPreview").textContent = fmtKz(custo + taxi);
  }
  $("#f_custo").addEventListener("input", updateTotalPreview);
  $("#f_taxi").addEventListener("input", updateTotalPreview);

  $("#f_foto").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast("Imagem muito grande. Escolha uma foto até 4MB.", "error");
      e.target.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      pendingPhotoDataUrl = reader.result;
      $("#fotoPreview").src = reader.result;
      $("#fotoPreview").hidden = false;
    };
    reader.readAsDataURL(file);
  });

  orderForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var isPerfume = $("#f_categoria").value === "Perfume";
    var id = $("#orderId").value;
    var isNew = !id;
    if (isNew) id = nextOrderId();

    var order = DB.orders.find(function (o) { return o.id === id; }) || {
      id: id, estado: "PENDENTE", criadoEm: Date.now()
    };

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

    if (pendingPhotoDataUrl) {
      photoCache[id] = pendingPhotoDataUrl;
      savePhoto(id, pendingPhotoDataUrl);
    }

    upsertClientFromOrder(order);
    closeModal(orderModal);
    toast(isNew ? "Encomenda criada com sucesso." : "Encomenda atualizada.", "success");
    router();
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
    $("#u_passHint").textContent = member ? "Deixe em branco para manter a palavra-passe atual." : "Mínimo 4 caracteres.";
    $("#u_pass").required = !member;
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
    tbody.innerHTML = DB.team.map(function (m) {
      return "<tr><td>" + escapeHtml(m.nome) + "</td><td>" + escapeHtml(m.user) + "</td><td>" + escapeHtml(m.funcao) +
        "</td><td>" + escapeHtml(m.estado) + '</td><td class="row-actions">' +
        '<button class="btn btn-outline btn-sm" data-edit="' + m.id + '">Editar</button>' +
        (m.user.toLowerCase() === "admin" ? "" : '<button class="btn btn-outline btn-sm" data-del="' + m.id + '">Remover</button>') +
        "</td></tr>";
    }).join("");
    $all("[data-edit]", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = DB.team.find(function (t) { return t.id === btn.getAttribute("data-edit"); });
        openUserModal(m);
      });
    });
    $all("[data-del]", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var m = DB.team.find(function (t) { return t.id === btn.getAttribute("data-del"); });
        confirmDialog('Remover o utilizador "' + m.nome + '"?').then(function (ok) {
          if (!ok) return;
          DB.team = DB.team.filter(function (t) { return t.id !== m.id; });
          persist(); renderTeam();
          toast("Utilizador removido.", "success");
        });
      });
    });
  }

  userForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var id = $("#u_id").value;
    var isNew = !id;
    var userVal = $("#u_user").value.trim();
    var passVal = $("#u_pass").value;

    var dupe = DB.team.find(function (t) { return t.user.toLowerCase() === userVal.toLowerCase() && t.id !== id; });
    if (dupe) { toast("Já existe um utilizador com este nome de acesso.", "error"); return; }
    if (isNew && passVal.length < 4) { toast("A palavra-passe deve ter pelo menos 4 caracteres.", "error"); return; }

    var member = DB.team.find(function (t) { return t.id === id; });
    if (!member) {
      member = { id: uid("u") };
      DB.team.push(member);
    }
    member.nome = $("#u_nome").value.trim();
    member.user = userVal;
    if (passVal) member.pass = passVal;
    member.funcao = $("#u_funcao").value;
    member.estado = $("#u_estado").value;

    persist();
    closeModal(userModal);
    renderTeam();
    toast("Utilizador guardado.", "success");
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
      '<div class="receipt-head"><h2>MAMBEMBA BUSINESS</h2><p>Cuidamos do teu estilo.</p></div>' +
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
      "<small>Validação local do recibo — aponte a câmara ou aceda a: " + escapeHtml(validateUrl) +
      "<br>Esta validação confirma a correspondência com este dispositivo, sem servidor central.</small></div>";

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

  /* ---------------------------------------------------------
     15) VALIDAÇÃO PÚBLICA DE RECIBO (via QR / link)
     --------------------------------------------------------- */
  function renderValidateScreen(orderId) {
    $("#loginScreen").hidden = true;
    $("#app").hidden = true;
    $("#validateScreen").hidden = false;

    var order = DB.orders.find(function (o) { return o.id === orderId; });
    var body = $("#validateBody");
    if (!order) {
      body.innerHTML = "<p>Nenhum recibo com o ID <b>" + escapeHtml(orderId || "—") +
        "</b> foi encontrado neste navegador. A validação local só funciona no dispositivo/loja que emitiu o recibo.</p>";
      return;
    }
    var total = Number(order.custo || 0) + Number(order.taxi || 0);
    body.innerHTML =
      vrow("ID", order.id) +
      vrow("Cliente", order.cliente) +
      vrow("Produto", order.produto) +
      vrow("Total", fmtKz(total)) +
      '<div class="vrow"><b>Estado</b><span class="validate-status ' + (order.estado === "ENTREGUE" ? "order-badge ENTREGUE" : "order-badge PENDENTE") + '">' + order.estado + "</span></div>";
  }
  function vrow(label, value) {
    return '<div class="vrow"><b>' + escapeHtml(label) + "</b><span>" + escapeHtml(value) + "</span></div>";
  }
  $("#validateBackBtn").addEventListener("click", function (e) {
    e.preventDefault();
    location.hash = getCurrentUser() ? "#/dashboard" : "#/login";
  });

  /* ---------------------------------------------------------
     16) PARTILHA (WhatsApp / E-mail / SMS)
     --------------------------------------------------------- */
  var shareModal = $("#shareModal");
  $("#shareReceiptBtn").addEventListener("click", function () { shareModal.hidden = false; });

  function buildOrderMessage(order) {
    var total = Number(order.custo || 0) + Number(order.taxi || 0);
    return "MAMBEMBA BUSINESS\n" +
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

  $("#shareWhatsapp").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    openWhatsApp(currentReceiptOrder.whatsapp || currentReceiptOrder.contacto, buildOrderMessage(currentReceiptOrder));
    shareModal.hidden = true;
  });
  $("#shareEmail").addEventListener("click", function () {
    if (!currentReceiptOrder) return;
    var subject = "Recibo Mambemba Business — " + currentReceiptOrder.id;
    var body = buildOrderMessage(currentReceiptOrder);
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    shareModal.hidden = true;
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
