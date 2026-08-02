import { firebaseConfig, WORKSPACE_ID } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const authMessageAtStartup = document.getElementById("authMessage");
if (authMessageAtStartup) {
  authMessageAtStartup.className = "message";
  authMessageAtStartup.textContent = "App loaded. Ready to sign in.";
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
enableIndexedDbPersistence(db).catch(() => {});

const platforms = ["", "eBay", "Poshmark", "Facebook Marketplace", "Mercari", "The RealReal", "Vestiaire Collective", "Consignment Store", "Direct / Private Sale", "Other"];
const estimatedFeeRates = {
  "eBay": 0.15, "Poshmark": 0.20, "Facebook Marketplace": 0,
  "Mercari": 0.10, "The RealReal": 0.40, "Vestiaire Collective": 0.15,
  "Consignment Store": 0.40, "Direct / Private Sale": 0, "Other": 0.15, "": 0
};

let items = [];
let unsubscribeItems = null;
let saveInProgress = false;
const $ = id => document.getElementById(id);
const number = v => Number(v || 0);
const money = v => new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(number(v));
const pct = v => `${(number(v) * 100).toFixed(1)}%`;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const itemCollection = () => collection(db, "Workspaces", WORKSPACE_ID, "items");


function setSyncState(state, text) {
  const badge = $("syncBadge");
  if (!badge) return;

  badge.textContent = text;
  badge.dataset.state = state;
}

function friendlyError(error) {
  const code = error?.code || "";
  const message = error?.message || "Something went wrong.";

  if (code.includes("auth/invalid-credential")) {
    return "The email or password is incorrect.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }

  if (code.includes("permission-denied")) {
    return "Firebase blocked this action. Check the Firestore security rules.";
  }

  if (code.includes("unavailable")) {
    return "Firebase is temporarily unavailable. Check your internet connection.";
  }

  return message;
}

function populatePlatforms() {
  ["expectedPlatform", "listingPlatform"].forEach(id => {
    $(id).innerHTML = platforms.map(p => `<option value="${p}">${p || "Select platform"}</option>`).join("");
  });
}

function calculation(i) {
  const purchase = number(i.purchasePrice);
  const shippingCosts = number(i.shippingCosts);
  const buyerShipping = number(i.buyerPaidShipping);
  const saleEntered = number(i.salePrice) > 0;
  const listingEntered = number(i.listingPrice) > 0;

  const revenue = saleEntered ? number(i.salePrice) : (listingEntered ? number(i.listingPrice) : number(i.expectedSellingPrice));
  const platform = saleEntered ? (i.listingPlatform || i.expectedPlatform || "") : (i.listingPlatform || i.expectedPlatform || "");
  const fee = saleEntered
    ? number(i.actualPlatformFee)
    : revenue * number(estimatedFeeRates[platform]);

  const netProceeds = revenue + buyerShipping - fee - shippingCosts;
  const profit = netProceeds - purchase;
  const roi = purchase > 0 ? profit / purchase : 0;
  const type = saleEntered ? "Actual" : "Projected";
  const basis = saleEntered ? "Sale price" : (listingEntered ? "Listing price" : "Expected price");

  return { purchase, revenue, fee, netProceeds, profit, roi, type, basis, saleEntered };
}

function showTab(id) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === id));
  window.scrollTo({top:0, behavior:"smooth"});
}

function renderMetrics() {
  const sold = items.filter(i => number(i.salePrice) > 0);
  const unsold = items.filter(i => !sold.includes(i));
  const invested = items.reduce((s,i) => s + number(i.purchasePrice), 0);
  const projectedProfit = unsold.reduce((s,i) => s + calculation(i).profit, 0);
  const actualProfit = sold.reduce((s,i) => s + calculation(i).profit, 0);
  const combinedProfit = projectedProfit + actualProfit;
  const combinedRoi = invested > 0 ? combinedProfit / invested : 0;

  const data = [
    ["Items", items.length, "All tracked inventory"],
    ["Sold", sold.length, "Actual sale price entered"],
    ["Inventory Cost", money(unsold.reduce((s,i)=>s+number(i.purchasePrice),0)), "Unsold purchase cost"],
    ["Projected Profit", money(projectedProfit), "Listing price, or expected price if not listed"],
    ["Actual Profit", money(actualProfit), "Completed sales"],
    ["Combined Profit", money(combinedProfit), "Projected + actual"],
    ["Combined ROI", pct(combinedRoi), "Based on purchase cost"]
  ];
  $("metrics").innerHTML = data.map(([label,value,sub]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`).join("");
}

function renderDashboardRows() {
  $("dashboardRows").innerHTML = items.length ? items.map(i => {
    const c = calculation(i);
    return `<tr>
      <td><strong>${escapeHtml(i.brand)} ${escapeHtml(i.itemName)}</strong></td>
      <td><span class="pill ${i.status === "Sold" ? "sold" : i.status === "Listed" ? "listed" : ""}">${escapeHtml(i.status || "In Inventory")}</span></td>
      <td>${c.type}</td><td>${c.basis}: ${money(c.revenue)}</td>
      <td class="${c.profit >= 0 ? "profit-positive" : "profit-negative"}">${money(c.profit)}</td>
      <td>${pct(c.roi)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">No items yet.</td></tr>`;
}

function renderItems() {
  const term = $("searchInput").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const filtered = items.filter(i => {
    const haystack = `${i.brand} ${i.itemName} ${i.purchaseSource} ${i.notes}`.toLowerCase();
    return (!term || haystack.includes(term)) && (!status || i.status === status);
  });

  $("emptyItems").hidden = filtered.length > 0;
  $("itemRows").innerHTML = filtered.map(i => {
    const c = calculation(i);
    const updated = i.updatedAt?.toDate ? i.updatedAt.toDate().toLocaleString() : "Syncing…";
    return `<tr>
      <td><strong>${escapeHtml(i.brand)}</strong><span class="muted">${escapeHtml(i.itemName)}</span></td>
      <td>${money(i.purchasePrice)}<span class="muted">${escapeHtml(i.purchaseDate || "")}</span></td>
      <td>${money(i.listingPrice)}<span class="muted">${escapeHtml(i.listingPlatform || "")}</span></td>
      <td>${number(i.salePrice) ? money(i.salePrice) : "—"}<span class="muted">${escapeHtml(i.saleDate || "")}</span></td>
      <td class="${c.profit >= 0 ? "profit-positive" : "profit-negative"}">${money(c.profit)}<span class="muted">${c.type}</span></td>
      <td>${pct(c.roi)}</td>
      <td><span class="pill ${i.status === "Sold" ? "sold" : i.status === "Listed" ? "listed" : ""}">${escapeHtml(i.status)}</span></td>
      <td class="muted">${updated}</td>
      <td><div class="row-actions"><button class="secondary edit-btn" data-id="${i.id}">Edit</button><button class="danger delete-btn" data-id="${i.id}">Delete</button></div></td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".edit-btn").forEach(btn => btn.onclick = () => editItem(btn.dataset.id));
  document.querySelectorAll(".delete-btn").forEach(btn => btn.onclick = () => removeItem(btn.dataset.id));
}

function renderAll() {
  renderMetrics();
  renderDashboardRows();
  renderItems();
}

function previewProfit() {
  const draft = readForm();
  const c = calculation(draft);
  $("profitPreview").classList.toggle("actual", c.saleEntered);
  $("profitPreview").innerHTML = `
    <div class="preview-cell"><div class="k">Calculation</div><div class="v">${c.type} Profit</div></div>
    <div class="preview-cell"><div class="k">Revenue Basis</div><div class="v">${c.basis}: ${money(c.revenue)}</div></div>
    <div class="preview-cell"><div class="k">${c.saleEntered ? "Actual" : "Estimated"} Fees</div><div class="v">${money(c.fee)}</div></div>
    <div class="preview-cell"><div class="k">Profit</div><div class="v ${c.profit >= 0 ? "profit-positive" : "profit-negative"}">${money(c.profit)}</div></div>
    <div class="preview-cell"><div class="k">ROI</div><div class="v">${pct(c.roi)}</div></div>`;
}

function readForm() {
  const fields = ["brand","itemName","category","status","colorMaterial","condition","accessories","authentication",
    "purchaseDate","purchaseSource","purchasePrice","targetProfit","expectedPlatform","expectedSellingPrice",
    "recommendedMaxBuy","marketConfidence","listingDate","listingPlatform","listingPrice","salePrice","saleDate",
    "actualPlatformFee","shippingCosts","buyerPaidShipping","notes","pricingAnalysis"];
  return Object.fromEntries(fields.map(id => [id, $(id).value]));
}

function setForm(i = {}) {
  const defaults = {category:"Handbag",status:"In Inventory",condition:"Excellent",authentication:"Not authenticated",
    targetProfit:"25",marketConfidence:"Medium",shippingCosts:"0",buyerPaidShipping:"0"};
  const values = {...defaults, ...i};
  Object.keys(values).forEach(k => { if ($(k)) $(k).value = values[k] ?? ""; });
  $("editId").value = i.id || "";
  $("formTitle").textContent = i.id ? "Edit Item" : "Add Item";
  $("deleteCurrentBtn").hidden = !i.id;
  $("formMessage").textContent = "";
  previewProfit();
}

async function saveItem(event) {
  event.preventDefault();

  if (saveInProgress) return;
  saveInProgress = true;

  const submitButtons = document.querySelectorAll('#itemForm button[type="submit"]');
  submitButtons.forEach(button => {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = "Saving…";
  });
  const data = readForm();
  if (!data.brand.trim() || !data.itemName.trim() || number(data.purchasePrice) < 0) return;
  if (number(data.salePrice) > 0) data.status = "Sold";
  data.purchasePrice = number(data.purchasePrice);
  data.targetProfit = number(data.targetProfit);
  data.expectedSellingPrice = number(data.expectedSellingPrice);
  data.recommendedMaxBuy = number(data.recommendedMaxBuy);
  data.listingPrice = number(data.listingPrice);
  data.salePrice = number(data.salePrice);
  data.actualPlatformFee = number(data.actualPlatformFee);
  data.shippingCosts = number(data.shippingCosts);
  data.buyerPaidShipping = number(data.buyerPaidShipping);
  data.updatedAt = serverTimestamp();
  data.updatedBy = auth.currentUser.email;

  $("formMessage").className = "message";
  $("formMessage").textContent = "Saving…";
  try {
    const id = $("editId").value;
    if (id) await updateDoc(doc(db, "Workspaces", WORKSPACE_ID, "items", id), data);
    else {
      data.createdAt = serverTimestamp();
      data.createdBy = auth.currentUser.email;
      await addDoc(itemCollection(), data);
    }
    $("formMessage").className = "message ok";
    $("formMessage").textContent = "Saved and synced.";
    setForm();
    showTab("items");
  } catch (error) {
    $("formMessage").className = "message error";
    $("formMessage").textContent = error.message;
  }
}

function editItem(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  setForm(i);
  showTab("add");
}

async function removeItem(id) {
  const i = items.find(x => x.id === id);
  if (!i || !confirm(`Delete ${i.brand} ${i.itemName}? This removes it for every device.`)) return;
  await deleteDoc(doc(db, "Workspaces", WORKSPACE_ID, "items", id));
  if ($("editId").value === id) setForm();
}

function startItemSync() {
  if (unsubscribeItems) unsubscribeItems();
  setSyncState("syncing", "Syncing…");
  const q = query(itemCollection(), orderBy("updatedAt", "desc"));
  unsubscribeItems = onSnapshot(q, snapshot => {
    items = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
    $("syncBadge").textContent = navigator.onLine ? "Cloud synced" : "Offline";
    renderAll();
  }, error => {
    setSyncState("error", "Sync error");
    console.error(error);
  });
}

onAuthStateChanged(auth, user => {
  $("authScreen").hidden = !!user;
  $("appShell").hidden = !user;
  if (user) {
    $("currentUser").textContent = `Signed in as ${user.email}`;
    setSyncState("syncing", "Connecting…");
    startItemSync();
    setForm();
  } else {
    if (unsubscribeItems) unsubscribeItems();
    items = [];
  }
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("authMessage").className = "message";
  $("authMessage").textContent = "Signing in…";
  try {
    await signInWithEmailAndPassword(auth, $("authEmail").value.trim(), $("authPassword").value);
    $("authMessage").textContent = "";
  } catch (error) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = friendlyError(error);
  }
});

$("createAccountBtn").onclick = async () => {
  $("authMessage").className = "message";
  $("authMessage").textContent = "Creating account…";
  try {
    await createUserWithEmailAndPassword(auth, $("authEmail").value.trim(), $("authPassword").value);
  } catch (error) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = friendlyError(error);
  }
};

$("signOutBtn").onclick = $("settingsSignOutBtn").onclick = () => signOut(auth);
$("itemForm").addEventListener("submit", saveItem);
$("cancelEditBtn").onclick = () => { setForm(); showTab("items"); };
$("newItemBtn").onclick = () => { setForm(); showTab("add"); };
$("deleteCurrentBtn").onclick = () => removeItem($("editId").value);
$("searchInput").addEventListener("input", renderItems);
$("statusFilter").addEventListener("change", renderItems);
document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
["purchasePrice","expectedSellingPrice","listingPrice","salePrice","actualPlatformFee","shippingCosts","buyerPaidShipping","expectedPlatform","listingPlatform"]
  .forEach(id => $(id).addEventListener("input", previewProfit));

window.addEventListener("online", () => $("syncBadge").textContent = "Reconnecting…");
window.addEventListener("offline", () => $("syncBadge").textContent = "Offline");

populatePlatforms();
