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
  { val: "rectangle", label: "Rectangle", desc: "L × H" },
  { val: "pignon_1",  label: "Pignon 1 pente", desc: "L×H + triangle" },
  { val: "pignon_2",  label: "Pignon 2 pentes", desc: "L×H + 2 triangles" },
  { val: "trapeze",   label: "Trapèze", desc: "(B1+B2)/2 × H" },
];

window.ajouterFacade = () => {
  const id = "f" + Date.now();
  const nom = "Façade " + facadeCounter++;
  facades.push({ id, nom, type: "rectangle", L:0, H:0, Hp:0, Hp2:0, B2:0, surface:0, mlOuv:0, mlArrets:0, nbFenetres:0, photo:null, commentaire:"" });
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

    // Inputs numériques
    ["L","H","Hp","Hp2","B2","mlOuv","mlArrets","nbFenetres"].forEach(key => {
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
  });
}

function buildFacadeHTML(f) {
  const typeOpts = FACADE_TYPES.map(t =>
    `<option value="${t.val}" ${f.type === t.val ? "selected" : ""}>${t.label}</option>`
  ).join("");

  // Champs supplémentaires selon type
  let extraFields = "";
  if (f.type === "pignon_1") {
    extraFields = `
      <div class="input-group">
        <label class="field-label">Hauteur pignon (m)</label>
        <input data-key="Hp" type="number" class="input input-sm" value="${f.Hp||""}" placeholder="Hp" step="0.01">
      </div>`;
  } else if (f.type === "pignon_2") {
    extraFields = `
      <div class="grid-2">
        <div class="input-group">
          <label class="field-label">Haut. pignon 1 (m)</label>
          <input data-key="Hp" type="number" class="input input-sm" value="${f.Hp||""}" placeholder="Hp1" step="0.01">
        </div>
        <div class="input-group">
          <label class="field-label">Haut. pignon 2 (m)</label>
          <input data-key="Hp2" type="number" class="input input-sm" value="${f.Hp2||""}" placeholder="Hp2" step="0.01">
        </div>
      </div>`;
  } else if (f.type === "trapeze") {
    extraFields = `
      <div class="input-group">
        <label class="field-label">Base haute (m)</label>
        <input data-key="B2" type="number" class="input input-sm" value="${f.B2||""}" placeholder="Base haute" step="0.01">
      </div>`;
  }

  const surfaceBadge = f.surface > 0
    ? `<span class="surface-badge">${f.surface} m²</span>`
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

  <!-- ML Ouvertures -->
  <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:10px">
    <div style="font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      Métrés linéaires
    </div>
    <div class="grid-3">
      <div class="input-group">
        <label class="field-label">ML baguettes ouv.</label>
        <input data-key="mlOuv" type="number" class="input input-sm" value="${f.mlOuv||""}" placeholder="0.00" step="0.1">
      </div>
      <div class="input-group">
        <label class="field-label">ML arrêts</label>
        <input data-key="mlArrets" type="number" class="input input-sm" value="${f.mlArrets||""}" placeholder="0.00" step="0.1">
      </div>
      <div class="input-group">
        <label class="field-label">Nb fenêtres</label>
        <input data-key="nbFenetres" type="number" class="input input-sm" value="${f.nbFenetres||""}" placeholder="0">
      </div>
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
  // Reset extra dims when type changes
  f.Hp = 0; f.Hp2 = 0; f.B2 = 0; f.surface = 0;
}

window.calcFacade = (f) => {
  const L = f.L, H = f.H;
  if (!L || !H) { toast("⚠️ Saisir largeur et hauteur"); return; }

  let surface = 0;
  switch (f.type) {
    case "rectangle":  surface = L * H; break;
    case "pignon_1":   surface = (L * H) + (L * f.Hp / 2); break;
    case "pignon_2":   surface = (L * H) + (L * f.Hp / 2) + (L * f.Hp2 / 2); break;
    case "trapeze":    surface = ((L + f.B2) / 2) * H; break;
  }

  f.surface = parseFloat(surface.toFixed(2));
  toast(`✅ ${f.nom} : ${f.surface} m²`);
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
  const totalSurface = facades.reduce((a, f) => a + (f.surface || 0), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + (parseFloat(f.mlOuv) || 0), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (parseInt(f.nbFenetres) || 0), 0);

  if (totalSurface > 0 || totalMLOuv > 0) {
    document.getElementById("totalsFacades").style.display = "block";
    document.getElementById("totalSurfaceFacades").textContent = totalSurface.toFixed(2) + " m²";
    document.getElementById("totalMLOuvertures").textContent  = totalMLOuv.toFixed(1) + " ml";
    document.getElementById("totalMLArrets").textContent      = totalMLArr.toFixed(1) + " ml";
    document.getElementById("totalFenetres").textContent      = totalFen;
  }
}

function autoFillQtyFromFacades() {
  const totalSurface = facades.reduce((a, f) => a + (f.surface || 0), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + (parseFloat(f.mlOuv) || 0), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (parseInt(f.nbFenetres) || 0), 0);

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

  const totalSurface = facades.reduce((a, f) => a + (f.surface || 0), 0);
  const totalMLOuv   = facades.reduce((a, f) => a + (parseFloat(f.mlOuv) || 0), 0);
  const totalMLArr   = facades.reduce((a, f) => a + (parseFloat(f.mlArrets) || 0), 0);
  const totalFen     = facades.reduce((a, f) => a + (parseInt(f.nbFenetres) || 0), 0);

  if (facades.length === 0 || totalSurface === 0) {
    document.getElementById("recapMetreBody").innerHTML = `<div class="empty-state" style="padding:16px"><p>Remplissez d'abord le métré ➜</p></div>`;
    return;
  }

  const facadeLines = facades.map(f =>
    `<div class="summary-line"><span>${f.nom}</span><span class="val">${f.surface} m²</span></div>`
  ).join("");

  document.getElementById("recapMetreBody").innerHTML = `
    ${facadeLines}
    <div class="sep"></div>
    <div class="summary-line" style="color:var(--slate)"><span><strong>Surface totale</strong></span><span class="val" style="color:var(--orange)"><strong>${totalSurface.toFixed(2)} m²</strong></span></div>
    <div class="summary-line"><span>ML baguettes ouvertures</span><span class="val">${totalMLOuv.toFixed(1)} ml</span></div>
    <div class="summary-line"><span>ML arrêts / jonctions</span><span class="val">${totalMLArr.toFixed(1)} ml</span></div>
    <div class="summary-line"><span>Nombre de fenêtres</span><span class="val">${totalFen}</span></div>
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

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
window.sendWhatsApp = () => {
  if (!lastDevisText) { toast("⚠️ Générez d'abord le devis"); return; }
  const phone = document.getElementById("clientPhone").value.replace(/\D/g, "");
  const url = phone
    ? `https://wa.me/33${phone.slice(1)}?text=${encodeURIComponent(lastDevisText)}`
    : `https://wa.me/?text=${encodeURIComponent(lastDevisText)}`;
  window.open(url, "_blank");
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
