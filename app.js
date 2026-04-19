import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, query, orderBy, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── FIREBASE CONFIG (ne pas modifier) ───────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBeSwiReLvYaV47FSQKLTGEo0ynA8gM1f8",
  authDomain: "app-isol.firebaseapp.com",
  projectId: "app-isol",
  storageBucket: "app-isol.firebasestorage.app",
  messagingSenderId: "49748280512",
  appId: "1:49748280512:web:76e89909bf358434689925",
  measurementId: "G-Y8LNJQ713T"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentPrices = [];
let facades = [];       // [{id, nom, type, L, H, Hp, surface, mlOuv, mlArrets, nbFenetres, photo, commentaire}]
let facadeCounter = 1;
let lastDevisText = "";

// ─── AUTH ─────────────────────────────────────────────────────────────────────
window.handleLogin = () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginError");
  errEl.style.display = "none";

  signInWithEmailAndPassword(auth, email, pass).catch(err => {
    errEl.textContent = "Email ou mot de passe incorrect";
    errEl.style.display = "block";
  });
};

window.handleLogout = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-content").style.display = "block";
    init();
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  // Écoute prestations/tarifs
  onSnapshot(collection(db, "prestations"), snap => {
    currentPrices = [];
    snap.forEach(d => currentPrices.push({ id: d.id, ...d.data() }));
    renderItemsContainer();
    renderItemsTable();
  });

  // Écoute historique
  onSnapshot(query(collection(db, "archives_devis"), orderBy("date", "desc")), snap => {
    renderHistory(snap);
  });

  // Ajouter une première façade par défaut
  ajouterFacade();

  // Init date
  document.getElementById("visitDate").value = new Date().toISOString().split("T")[0];
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
window.showSection = (id) => {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("section-" + id).classList.add("active");
  document.getElementById("tab-" + id).classList.add("active");

  if (id === "devis") updateRecapMetre();
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// ─── FAÇADES ─────────────────────────────────────────────────────────────────
const FACADE_TYPES = [
  { val: "rectangle",  label: "Rectangle",           desc: "L × H" },
  { val: "pignon_1",   label: "Pignon 1 pente",       desc: "L×H + ½ triangle" },
  { val: "pignon_2",   label: "Pignon 2 pentes",      desc: "L×H + triangle (1 Hp)" },
  { val: "pignon_asy", label: "Pignon asymétrique",   desc: "L×H + 2 triangles inégaux" },
  { val: "trapeze",    label: "Trapèze",               desc: "(B1+B2)÷2 × H" },
];

window.ajouterFacade = () => {
  const id = "f" + Date.now();
  const nom = "Façade " + facadeCounter++;
  facades.push({ id, nom, type: "rectangle", L:0, H:0, Hp:0, Hp2:0, B2:0, surface:0, surfaceNette:0, ouvertures:[], mlArrets:0, photo:null, commentaire:"" });
  renderFacades();
};

window.supprimerFacade = (id) => {
  facades = facades.filter(f => f.id !== id);
  renderFacades();
  recalcTotaux();
};

function renderFacades() {
  const container = document.getElementById("facadesContainer");
  if (facades.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:20px"><p>Aucune façade. Cliquez sur + Ajouter.</p></div>`;
    document.getElementById("totalsFacades").style.display = "none";
    return;
  }

  container.innerHTML = facades.map(f => buildFacadeHTML(f)).join("");

  // Bind events
  facades.forEach(f => {
    const el = document.getElementById("facade-" + f.id);
    if (!el) return;

    // Type change
    el.querySelector(".facade-type-sel").addEventListener("change", e => {
      f.type = e.target.value;
      updateFacadeTypeFields(f);
      renderFacades();
    });

    // Inputs numériques dimensions façade
    ["L","H","Hp","Hp2","B2","mlArrets"].forEach(key => {
      const inp = el.querySelector(`[data-key="${key}"]`);
      if (!inp) return;
      inp.addEventListener("input", e => {
        f[key] = parseFloat(e.target.value) || 0;
      });
    });

    // Commentaire
    const comm = el.querySelector(".facade-comment");
    if (comm) comm.addEventListener("input", e => { f.commentaire = e.target.value; });

    // Photo
    const photoInput = el.querySelector(".photo-file");
    if (photoInput) photoInput.addEventListener("change", e => handlePhoto(e, f));

    // Nom
    const nomInp = el.querySelector(".facade-nom-input");
    if (nomInp) nomInp.addEventListener("input", e => { f.nom = e.target.value; });

    // Calcul
    el.querySelector(".btn-calc-facade").addEventListener("click", () => calcFacade(f));

    // Ouvertures
    bindOuverturesEvents(f);
  });
}

function buildFacadeHTML(f) {
  const typeOpts = FACADE_TYPES.map(t =>
    `<option value="${t.val}" ${f.type === t.val ? "selected" : ""}>${t.label}</option>`
  ).join("");

  // Champs supplémentaires selon type
  let extraFields = "";
  if (f.type === "pignon_1" || f.type === "pignon_2") {
    // Pignon 1 pente : triangle d'un côté
    // Pignon 2 pentes symétrique : même formule, triangle centré → 1 seul Hp
    extraFields = `
      <div class="input-group">
        <label class="field-label">Hauteur pignon (m)</label>
        <input data-key="Hp" type="number" class="input input-sm" value="${f.Hp||""}" placeholder="Hp — du mur au faîtage" step="0.01">
      </div>`;
  } else if (f.type === "pignon_asy") {
    // Pignon asymétrique : 2 triangles de hauteurs différentes
    extraFields = `
      <div style="background:#fff7ed;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#92400e">
        ⚠ 2 pentes inégales — saisir chaque hauteur séparément
      </div>
      <div class="grid-2">
        <div class="input-group">
          <label class="field-label">Hp pente gauche (m)</label>
          <input data-key="Hp" type="number" class="input input-sm" value="${f.Hp||""}" placeholder="Hp1" step="0.01">
        </div>
        <div class="input-group">
          <label class="field-label">Hp pente droite (m)</label>
          <input data-key="Hp2" type="number" class="input input-sm" value="${f.Hp2||""}" placeholder="Hp2" step="0.01">
        </div>
      </div>`;
  } else if (f.type === "trapeze") {
    extraFields = `
      <div class="input-group">
        <label class="field-label">Base haute (m)</label>
        <input data-key="B2" type="number" class="input input-sm" value="${f.B2||""}" placeholder="Longueur base haute" step="0.01">
      </div>`;
  }

  const surfaceBadge = f.surface > 0
    ? `<span class="surface-badge">${f.surfaceNette} m² net</span><span class="chip" style="font-size:10px;margin-left:4px">${f.surface} brut</span>`
    : `<span class="chip">Non calculé</span>`;

  const photoHTML = f.photo
    ? `<img src="${f.photo}" alt="photo">
       <p class="photo-label" style="margin-top:4px;color:var(--orange)">📷 Photo enregistrée</p>`
    : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:#94a3b8;margin:0 auto;display:block"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <p class="photo-label">Ajouter une photo</p>`;

  return `
<div class="facade-entry" id="facade-${f.id}">
  <div class="facade-entry-header">
    <input class="facade-nom-input" value="${f.nom}" style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;border:none;background:transparent;color:var(--slate);width:120px;outline:none;">
    ${surfaceBadge}
    <button class="btn btn-sm btn-danger" onclick="supprimerFacade('${f.id}')">✕</button>
  </div>

  <div class="input-group">
    <label class="field-label">Type de façade</label>
    <select class="input input-sm facade-type-sel">${typeOpts}</select>
  </div>

  <div class="grid-2">
    <div class="input-group">
      <label class="field-label">Largeur (m)</label>
      <input data-key="L" type="number" class="input input-sm" value="${f.L||""}" placeholder="Largeur" step="0.01">
    </div>
    <div class="input-group">
      <label class="field-label">Hauteur (m)</label>
      <input data-key="H" type="number" class="input input-sm" value="${f.H||""}" placeholder="Hauteur" step="0.01">
    </div>
  </div>

  ${extraFields}

  <button class="btn btn-dark btn-full btn-calc-facade" style="margin-bottom:12px">
    📐 Calculer surface
  </button>

  <!-- Ouvertures (fenêtres, portes…) -->
  <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:10px" id="ouv-container-${f.id}">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">
        Ouvertures (déduction + ML)
      </div>
      <button class="btn btn-sm btn-ghost" onclick="ajouterOuverture('${f.id}')" style="padding:4px 10px;font-size:11px">+ Ouverture</button>
    </div>
    ${buildOuverturesHTML(f)}
    <div style="margin-top:8px;padding:6px 10px;background:white;border-radius:6px;border:1px solid var(--gray-border);display:flex;justify-content:space-between;font-size:12px">
      <span style="color:var(--text-muted)">Surface ouvertures : <strong style="color:var(--red)" id="ouv-surf-${f.id}">${calcSurfOuv(f).toFixed(2)} m²</strong></span>
      <span style="color:var(--text-muted)">ML périmètre : <strong style="color:var(--orange)" id="ouv-ml-${f.id}">${calcMLOuv(f).toFixed(1)} ml</strong></span>
    </div>
  </div>

  <!-- ML arrêts manuels -->
  <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:10px">
    <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      ML arrêts / jonctions (saisi manuellement)
    </div>
    <div class="input-group">
      <label class="field-label">ML arrêts — soubassement, angles, jonctions… (ml)</label>
      <input data-key="mlArrets" type="number" class="input input-sm" value="${f.mlArrets||""}" placeholder="0.00" step="0.1">
    </div>
  </div>

  <!-- Photo -->
  <div class="photo-zone" onclick="document.getElementById('photo-${f.id}').click()">
    ${photoHTML}
    <input type="file" id="photo-${f.id}" class="photo-file" accept="image/*" capture="environment" style="display:none">
  </div>

  <!-- Commentaire -->
  <div class="input-group" style="margin-top:10px">
    <label class="field-label">Commentaire / Annexe</label>
    <textarea class="input input-sm facade-comment" rows="2" placeholder="Observations sur cette façade…">${f.commentaire||""}</textarea>
  </div>
</div>`;
}

function updateFacadeTypeFields(f) {
  f.Hp = 0; f.Hp2 = 0; f.B2 = 0; f.surface = 0; f.surfaceNette = 0;
}

// ─── OUVERTURES ───────────────────────────────────────────────────────────────
const OUV_TYPES = [
  { val: "fenetre",       label: "Fenêtre" },
  { val: "porte",         label: "Porte d'entrée" },
  { val: "porte_garage",  label: "Porte de garage" },
  { val: "baie",          label: "Baie vitrée" },
  { val: "autre",         label: "Autre" },
];

function buildOuverturesHTML(f) {
  if (!f.ouvertures || f.ouvertures.length === 0) {
    return `<div style="text-align:center;font-size:12px;color:#94a3b8;padding:6px 0">Aucune ouverture — cliquez + Ouverture</div>`;
  }
  return f.ouvertures.map((o, i) => {
    const typeOpts = OUV_TYPES.map(t =>
      `<option value="${t.val}" ${o.type === t.val ? "selected" : ""}>${t.label}</option>`
    ).join("");
    const surf = ((o.L||0) * (o.H||0)).toFixed(2);
    const ml   = (2 * ((o.L||0) + (o.H||0))).toFixed(1);
    return `
    <div style="background:white;border:1px solid var(--gray-border);border-radius:6px;padding:8px;margin-bottom:6px" id="ouv-${f.id}-${i}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <select class="input input-sm ouv-type" data-fid="${f.id}" data-idx="${i}" style="flex:1">
          ${typeOpts}
        </select>
        <button class="btn btn-sm btn-danger" onclick="supprimerOuverture('${f.id}',${i})" style="padding:4px 8px">✕</button>
      </div>
      <div class="grid-2">
        <div>
          <label class="field-label">Larg. (m)</label>
          <input type="number" class="input input-sm ouv-dim" data-fid="${f.id}" data-idx="${i}" data-dim="L" value="${o.L||""}" placeholder="L" step="0.01">
        </div>
        <div>
          <label class="field-label">Haut. (m)</label>
          <input type="number" class="input input-sm ouv-dim" data-fid="${f.id}" data-idx="${i}" data-dim="H" value="${o.H||""}" placeholder="H" step="0.01">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px;font-size:11px;color:#64748b">
        <span>Surface : <strong style="color:var(--red)">${surf} m²</strong></span>
        <span>·</span>
        <span>ML périmètre : <strong style="color:var(--orange)">${ml} ml</strong></span>
      </div>
    </div>`;
  }).join("");
}

function calcSurfOuv(f) {
  return (f.ouvertures||[]).reduce((a, o) => a + ((o.L||0) * (o.H||0)), 0);
}

function calcMLOuv(f) {
  return (f.ouvertures||[]).reduce((a, o) => a + 2 * ((o.L||0) + (o.H||0)), 0);
}

function bindOuverturesEvents(f) {
  const el = document.getElementById("facade-" + f.id);
  if (!el) return;

  el.querySelectorAll(".ouv-type").forEach(sel => {
    sel.addEventListener("change", e => {
      const idx = parseInt(e.target.dataset.idx);
      f.ouvertures[idx].type = e.target.value;
    });
  });

  el.querySelectorAll(".ouv-dim").forEach(inp => {
    inp.addEventListener("input", e => {
      const idx = parseInt(e.target.dataset.idx);
      const dim = e.target.dataset.dim;
      f.ouvertures[idx][dim] = parseFloat(e.target.value) || 0;
      refreshOuverturesBadges(f);
    });
  });
}

function refreshOuverturesBadges(f) {
  const surfEl = document.getElementById(`ouv-surf-${f.id}`);
  const mlEl   = document.getElementById(`ouv-ml-${f.id}`);
  if (surfEl) surfEl.textContent = calcSurfOuv(f).toFixed(2) + " m²";
  if (mlEl)   mlEl.textContent   = calcMLOuv(f).toFixed(1) + " ml";
  // Recalc ouvertures inline labels
  const container = document.getElementById("ouv-container-" + f.id);
  if (!container) return;
  f.ouvertures.forEach((o, i) => {
    const row = container.querySelector(`#ouv-${f.id}-${i}`);
    if (!row) return;
    const spans = row.querySelectorAll("strong");
    if (spans[0]) spans[0].textContent = ((o.L||0)*(o.H||0)).toFixed(2) + " m²";
    if (spans[1]) spans[1].textContent = (2*((o.L||0)+(o.H||0))).toFixed(1) + " ml";
  });
  recalcTotaux();
  autoFillQtyFromFacades();
}

window.ajouterOuverture = (fid) => {
  const f = facades.find(x => x.id === fid);
  if (!f) return;
  f.ouvertures.push({ type: "fenetre", L: 0, H: 0 });
  renderFacades();
};

window.supprimerOuverture = (fid, idx) => {
  const f = facades.find(x => x.id === fid);
  if (!f) return;
  f.ouvertures.splice(idx, 1);
  renderFacades();
  recalcTotaux();
  autoFillQtyFromFacades();
};

window.calcFacade = (f) => {
  const L = f.L, H = f.H;
  if (!L || !H) { toast("⚠️ Saisir largeur et hauteur"); return; }

  let surface = 0;
  switch (f.type) {
    case "rectangle":  surface = L * H; break;
    case "pignon_1":   surface = (L * H) + (L * f.Hp / 2); break;
    case "pignon_2":   surface = (L * H) + (L * f.Hp / 2); break;        // triangle centré symétrique = même formule
    case "pignon_asy": surface = (L * H) + (L * f.Hp / 2) + (L * f.Hp2 / 2); break; // 2 triangles inégaux
    case "trapeze":    surface = ((L + f.B2) / 2) * H; break;
  }

  f.surface = parseFloat(surface.toFixed(2));
  const surfOuv = parseFloat(calcSurfOuv(f).toFixed(2));
  f.surfaceNette = parseFloat(Math.max(0, f.surface - surfOuv).toFixed(2));
  toast(`✅ ${f.nom} : ${f.surface} m² brut → ${f.surfaceNette} m² net (−${surfOuv} ouv.)`);
  renderFacades();
  recalcTotaux();
  autoFillQtyFromFacades();
};

function handlePhoto(e, f) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    f.photo = ev.target.result;
    renderFacades();
    toast("📷 Photo enregistrée");
  };
  reader.readAsDataURL(file);
}

function recalcTotaux() {
  const totalSurface = facades.reduce((a, f) => a + (f.surfaceNette || 0), 0);
  const totalSurfBrut= facades.reduce((a, f) => a + (f.surface || 0), 0);
  const totalSurfOuv = facades.reduce((a, f) => a + calcSurfOuv(f), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + calcMLOuv(f), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (f.ouvertures||[]).length, 0);

  if (totalSurfBrut > 0 || totalMLOuv > 0) {
    document.getElementById("totalsFacades").style.display = "block";
    document.getElementById("totalSurfaceFacades").textContent = totalSurface.toFixed(2) + " m² net (" + totalSurfBrut.toFixed(2) + " brut − " + totalSurfOuv.toFixed(2) + " ouv.)";
    document.getElementById("totalMLOuvertures").textContent  = totalMLOuv.toFixed(1) + " ml";
    document.getElementById("totalMLArrets").textContent      = totalMLArr.toFixed(1) + " ml";
    document.getElementById("totalFenetres").textContent      = totalFen;
  }
}

function autoFillQtyFromFacades() {
  const totalSurface = facades.reduce((a, f) => a + (f.surfaceNette || 0), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + calcMLOuv(f), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (f.ouvertures||[]).length, 0);

  document.querySelectorAll(".qty-input").forEach(inp => {
    const p = currentPrices.find(x => x.id === inp.dataset.id);
    if (!p) return;
    if (p.unite === "m²" && totalSurface > 0) inp.value = totalSurface.toFixed(2);
    if (p.unite === "ml" && totalMLOuv > 0)   inp.value = totalMLOuv.toFixed(1);
    if (p.unite === "U"  && totalFen > 0)      inp.value = totalFen;
  });
}

// ─── RECAP METRE (dans l'onglet Devis) ───────────────────────────────────────
function updateRecapMetre() {
  const name = document.getElementById("clientName").value || "—";
  document.getElementById("recapClientChip").textContent = name;

  const totalSurface = facades.reduce((a, f) => a + (f.surfaceNette || 0), 0);
  const totalSurfBrut= facades.reduce((a, f) => a + (f.surface || 0), 0);
  const totalSurfOuv = facades.reduce((a, f) => a + calcSurfOuv(f), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + calcMLOuv(f), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (f.ouvertures||[]).length, 0);

  if (facades.length === 0 || totalSurfBrut === 0) {
    document.getElementById("recapMetreBody").innerHTML = `<div class="empty-state" style="padding:16px"><p>Remplissez d'abord le métré ➜</p></div>`;
    return;
  }

  const facadeLines = facades.map(f => {
    const ouvCount = (f.ouvertures||[]).length;
    return `<div class="summary-line">
      <span>${f.nom}${ouvCount > 0 ? ` <span style="font-size:10px;opacity:.7">(${ouvCount} ouv.)</span>` : ""}</span>
      <span class="val">${f.surfaceNette} m² net <span style="opacity:.5;font-size:11px">(${f.surface} brut)</span></span>
    </div>`;
  }).join("");

  document.getElementById("recapMetreBody").innerHTML = `
    ${facadeLines}
    <div class="sep"></div>
    <div class="summary-line"><span>Surface brute</span><span class="val">${totalSurfBrut.toFixed(2)} m²</span></div>
    <div class="summary-line"><span style="color:var(--red)">− Ouvertures (${totalFen} ouv.)</span><span class="val" style="color:var(--red)">−${totalSurfOuv.toFixed(2)} m²</span></div>
    <div class="summary-line" style="color:var(--slate)"><span><strong>= Surface nette ITE</strong></span><span class="val" style="color:var(--orange)"><strong>${totalSurface.toFixed(2)} m²</strong></span></div>
    <div class="sep"></div>
    <div class="summary-line"><span>ML baguettes ouvertures (auto)</span><span class="val">${totalMLOuv.toFixed(1)} ml</span></div>
    <div class="summary-line"><span>ML arrêts / jonctions</span><span class="val">${totalMLArr.toFixed(1)} ml</span></div>
  `;

  // Auto-remplir les qtés
  autoFillQtyFromFacades();
}

// ─── PRESTATIONS / TARIFS ─────────────────────────────────────────────────────
function renderItemsContainer() {
  const el = document.getElementById("itemsContainer");
  if (currentPrices.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>Ajoutez des prestations dans l'onglet Tarifs</p></div>`;
    return;
  }

  el.innerHTML = currentPrices.map(p => `
    <div class="prestation-row">
      <div class="prestation-info">
        <div class="prestation-name">${p.nom}</div>
        <div class="prestation-price">${p.prix} €/${p.unite}${p.categorie ? ' · ' + p.categorie : ''}</div>
      </div>
      <div class="prestation-qty">
        <input type="number" data-id="${p.id}" class="qty-input" placeholder="0" step="0.01" min="0">
        <span class="qty-unit">${p.unite}</span>
      </div>
    </div>
  `).join("");
}

function renderItemsTable() {
  const el = document.getElementById("itemsTable");
  if (currentPrices.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:24px"><p>Aucune prestation configurée</p></div>`;
    return;
  }

  el.innerHTML = currentPrices.map(p => `
    <div class="tarif-row">
      <div class="tarif-info">
        <div class="tarif-name">${p.nom}</div>
        <div style="font-size:12px;color:var(--text-muted)">${p.categorie || "—"}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="tarif-price-badge">${p.prix} €/${p.unite}</span>
        <button class="btn btn-sm btn-danger" onclick="deleteItem('${p.id}')">✕</button>
      </div>
    </div>
  `).join("");
}

window.saveItem = async () => {
  const nom = document.getElementById("itemLabel").value.trim();
  const prix = parseFloat(document.getElementById("itemPrice").value);
  const unite = document.getElementById("itemUnit").value;
  const categorie = document.getElementById("itemCategory").value;

  if (!nom || isNaN(prix)) { toast("⚠️ Nom et prix requis"); return; }

  await addDoc(collection(db, "prestations"), { nom, prix, unite, categorie });

  document.getElementById("itemLabel").value = "";
  document.getElementById("itemPrice").value = "";
  toast("✅ Prestation ajoutée");
};

window.deleteItem = id => {
  deleteDoc(doc(db, "prestations", id));
  toast("🗑️ Supprimé");
};

// ─── GÉNÉRATION DEVIS ─────────────────────────────────────────────────────────
window.genererDevis = async () => {
  const client  = document.getElementById("clientName").value || "Client";
  const adresse = document.getElementById("clientAddress").value || "";
  const remise  = parseFloat(document.getElementById("devisRemise").value) || 0;
  const tvaRate = parseFloat(document.getElementById("devisTVA").value);
  const comment = document.getElementById("devisComment").value;
  const date    = document.getElementById("visitDate").value;

  let totalHT = 0;
  const lines = [];

  document.querySelectorAll(".qty-input").forEach(inp => {
    const q = parseFloat(inp.value) || 0;
    if (q > 0) {
      const p = currentPrices.find(x => x.id === inp.dataset.id);
      if (!p) return;
      const st = parseFloat((q * p.prix).toFixed(2));
      totalHT += st;
      lines.push({ nom: p.nom, qte: q, unite: p.unite, pu: p.prix, st });
    }
  });

  if (lines.length === 0) { toast("⚠️ Aucune prestation renseignée"); return; }

  const remiseMt  = parseFloat((totalHT * remise / 100).toFixed(2));
  const htApres   = parseFloat((totalHT - remiseMt).toFixed(2));
  const tva       = parseFloat((htApres * tvaRate / 100).toFixed(2));
  const ttc       = parseFloat((htApres + tva).toFixed(2));
  const totalSurf = facades.reduce((a, f) => a + (f.surface || 0), 0).toFixed(2);

  // Render résumé
  const linesHTML = lines.map(l => `
    <div class="summary-line">
      <span>${l.nom} (${l.qte} ${l.unite})</span>
      <span class="val">${l.st.toFixed(2)} €</span>
    </div>
  `).join("");

  document.getElementById("summaryLines").innerHTML = `
    ${linesHTML}
    ${remise > 0 ? `<div class="summary-line"><span>Remise ${remise}%</span><span class="val" style="color:#ef4444">-${remiseMt.toFixed(2)} €</span></div>` : ""}
  `;

  document.getElementById("summaryHT").textContent    = htApres.toFixed(2) + " €";
  document.getElementById("summaryTVApct").textContent = tvaRate;
  document.getElementById("summaryTVA").textContent   = tva.toFixed(2) + " €";
  document.getElementById("summaryTotalTTC").textContent = ttc.toFixed(2) + " €";
  document.getElementById("summaryCard").style.display  = "block";

  // Texte WhatsApp / PDF
  const lignesTexte = lines.map(l =>
    `• ${l.nom} : ${l.qte} ${l.unite} × ${l.pu}€ = ${l.st.toFixed(2)}€`
  ).join("\n");

  lastDevisText = `ISOL-PRESTIGE — ESTIMATION
============================
Client : ${client}
Adresse : ${adresse}
Date : ${date}
============================
Surface totale : ${totalSurf} m²

PRESTATIONS :
${lignesTexte}
${remise > 0 ? `\nRemise ${remise}% : -${remiseMt.toFixed(2)}€` : ""}
============================
Total HT  : ${htApres.toFixed(2)} €
TVA ${tvaRate}% : ${tva.toFixed(2)} €
TOTAL TTC : ${ttc.toFixed(2)} €
============================
${comment ? "\nRemarques : " + comment : ""}

ISOL-PRESTIGE — Devis établi le ${date}`;

  // Sauvegarde Firestore
  await addDoc(collection(db, "archives_devis"), {
    client, adresse, date,
    totalHT: htApres, totalTTC: ttc,
    surface: totalSurf,
    lignes: lines,
    devisText: lastDevisText,
    timestamp: Date.now()
  });

  toast("✅ Devis généré et sauvegardé");
  document.getElementById("summaryCard").scrollIntoView({ behavior: "smooth" });
};

// ─── WHATSAPP AU CHOIX ────────────────────────────────────────────────────────
window.sendWhatsApp = () => {
  if (!lastDevisText) { toast("⚠️ Générez d'abord le devis"); return; }

  const clientPhone = document.getElementById("clientPhone").value.replace(/\D/g, "");
  const clientName  = document.getElementById("clientName").value || "client";

  // Afficher modal de choix
  const modal = document.createElement("div");
  modal.id = "wa-modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:flex-end;justify-content:center";
  modal.innerHTML = `
    <div style="background:white;border-radius:20px 20px 0 0;padding:24px;width:100%;max-width:480px">
      <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:16px;margin-bottom:4px">Envoyer par WhatsApp</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:18px">Choisissez le destinataire</div>

      ${clientPhone ? `
      <button onclick="envoyerWA('${clientPhone}')" style="width:100%;background:#25D366;color:white;border:none;border-radius:12px;padding:14px;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
        ${clientName} — ${formatPhone(clientPhone)}
      </button>` : ""}

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <input id="wa-autre-phone" type="tel" placeholder="Autre numéro (06 00 00 00 00)" style="flex:1;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;font-family:'DM Sans',sans-serif">
        <button onclick="envoyerWAAutre()" style="background:#0f172a;color:white;border:none;border-radius:10px;padding:12px 16px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer">
          Envoyer
        </button>
      </div>

      <button onclick="envoyerWA('')" style="width:100%;background:#f1f5f9;color:#334155;border:none;border-radius:12px;padding:12px;font-family:'Syne',sans-serif;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:10px">
        Ouvrir WhatsApp sans numéro
      </button>

      <button onclick="document.getElementById('wa-modal').remove()" style="width:100%;background:transparent;color:#94a3b8;border:none;padding:10px;font-size:14px;cursor:pointer">
        Annuler
      </button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
};

function formatPhone(digits) {
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

window.envoyerWA = (digits) => {
  document.getElementById("wa-modal")?.remove();
  const txt = encodeURIComponent(lastDevisText);
  if (digits && digits.length >= 9) {
    const intl = digits.startsWith("0") ? "33" + digits.slice(1) : digits;
    window.open(`https://wa.me/${intl}?text=${txt}`, "_blank");
  } else {
    window.open(`https://wa.me/?text=${txt}`, "_blank");
  }
};

window.envoyerWAAutre = () => {
  const val = document.getElementById("wa-autre-phone").value.replace(/\D/g, "");
  if (!val) { toast("⚠️ Saisissez un numéro"); return; }
  envoyerWA(val);
};

// ─── EXPORT PDF (impression navigateur) ──────────────────────────────────────
window.exportPDF = () => {
  if (!lastDevisText) { toast("⚠️ Générez d'abord le devis"); return; }

  const client  = document.getElementById("clientName").value || "Client";
  const adresse = document.getElementById("clientAddress").value || "";
  const date    = document.getElementById("visitDate").value;
  const totalSurf = facades.reduce((a, f) => a + (f.surface || 0), 0).toFixed(2);

  const lines = [];
  document.querySelectorAll(".qty-input").forEach(inp => {
    const q = parseFloat(inp.value) || 0;
    if (q > 0) {
      const p = currentPrices.find(x => x.id === inp.dataset.id);
      if (p) lines.push({ nom: p.nom, qte: q, unite: p.unite, pu: p.prix, st: (q * p.prix).toFixed(2) });
    }
  });

  const remise  = parseFloat(document.getElementById("devisRemise").value) || 0;
  const tvaRate = parseFloat(document.getElementById("devisTVA").value);
  const totalHT = lines.reduce((a, l) => a + parseFloat(l.st), 0);
  const remiseMt = totalHT * remise / 100;
  const htApres  = totalHT - remiseMt;
  const tva      = htApres * tvaRate / 100;
  const ttc      = htApres + tva;

  const facadesHTML = facades.filter(f => f.surface > 0).map(f => `
    <tr>
      <td>${f.nom}</td>
      <td>${f.surface} m²</td>
      <td>${f.mlOuv || 0} ml</td>
      <td>${f.mlArrets || 0} ml</td>
      <td>${f.nbFenetres || 0}</td>
    </tr>
  `).join("");

  const lignesHTML = lines.map(l => `
    <tr>
      <td>${l.nom}</td>
      <td>${l.qte} ${l.unite}</td>
      <td>${l.pu} €</td>
      <td><strong>${l.st} €</strong></td>
    </tr>
  `).join("");

  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html lang="fr"><head>
  <meta charset="UTF-8"><title>Devis ISOL-PRESTIGE</title>
  <style>
    body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#1e293b;font-size:14px;}
    h1{font-size:24px;color:#f97316;letter-spacing:2px;margin-bottom:4px;}
    .subtitle{color:#64748b;font-size:13px;margin-bottom:28px;}
    .info-block{background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;display:flex;justify-content:space-between;}
    table{width:100%;border-collapse:collapse;margin-bottom:16px;}
    th{background:#0f172a;color:white;padding:10px 12px;text-align:left;font-size:12px;letter-spacing:.5px;}
    td{padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;}
    tr:last-child td{border-bottom:none;}
    .total-box{background:#0f172a;color:white;padding:16px 20px;border-radius:8px;text-align:right;}
    .total-box .ht{color:#94a3b8;font-size:13px;margin-bottom:4px;}
    .total-box .ttc{font-size:22px;font-weight:700;color:#f97316;}
    .footer{margin-top:40px;text-align:center;color:#94a3b8;font-size:12px;}
    @media print{body{padding:20px;}button{display:none;}}
  </style>
  </head><body>
  <h1>ISOL·PRESTIGE</h1>
  <div class="subtitle">Estimation — ${date}</div>
  <div class="info-block">
    <div><strong>Client :</strong> ${client}<br><span style="color:#64748b">${adresse}</span></div>
    <div style="text-align:right"><strong>Surface totale :</strong><br><span style="font-size:22px;font-weight:700;color:#f97316">${totalSurf} m²</span></div>
  </div>

  <h3 style="margin-bottom:8px">📐 Métré façades</h3>
  <table>
    <thead><tr><th>Façade</th><th>Surface</th><th>ML ouv.</th><th>ML arrêts</th><th>Fenêtres</th></tr></thead>
    <tbody>${facadesHTML}</tbody>
  </table>

  <h3 style="margin-bottom:8px">📋 Prestations</h3>
  <table>
    <thead><tr><th>Désignation</th><th>Quantité</th><th>P.U.</th><th>Sous-total</th></tr></thead>
    <tbody>${lignesHTML}</tbody>
  </table>

  <div class="total-box">
    <div class="ht">Total HT : ${htApres.toFixed(2)} € · TVA ${tvaRate}% : ${tva.toFixed(2)} €${remise > 0 ? ` · Remise ${remise}% : -${remiseMt.toFixed(2)} €` : ""}</div>
    <div class="ttc">TOTAL TTC : ${ttc.toFixed(2)} €</div>
  </div>

  <div class="footer">ISOL-PRESTIGE — Document généré le ${new Date().toLocaleDateString("fr-FR")}</div>
  <br><button onclick="window.print()" style="display:block;margin:20px auto;padding:12px 28px;background:#f97316;color:white;border:none;border-radius:8px;font-size:15px;cursor:pointer;">🖨️ Imprimer / Enregistrer PDF</button>
  </body></html>`);
  win.document.close();
};

// ─── HISTORIQUE CLIENTS ───────────────────────────────────────────────────────
function renderHistory(snap) {
  const el = document.getElementById("historyList");
  if (snap.empty) {
    el.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <p>Aucun client enregistré</p>
    </div>`;
    return;
  }

  el.innerHTML = "";
  snap.forEach(d => {
    const data = d.data();
    const dateStr = data.date ? new Date(data.timestamp || data.date).toLocaleDateString("fr-FR") : "—";
    const div = document.createElement("div");
    div.className = "history-card";
    div.innerHTML = `
      <div>
        <div class="history-client">${data.client || "—"}</div>
        <div class="history-meta">${data.adresse || ""} · ${dateStr} · ${data.surface || "?"} m²</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="history-total">${(data.totalTTC || data.total || 0).toFixed(2)} €</div>
        <button class="btn btn-sm btn-danger" onclick="deleteDevis('${d.id}')">✕</button>
      </div>
    `;
    el.appendChild(div);
  });
}

window.deleteDevis = id => {
  if (confirm("Supprimer ce devis ?")) {
    deleteDoc(doc(db, "archives_devis", id));
    toast("🗑️ Devis supprimé");
  }
};
