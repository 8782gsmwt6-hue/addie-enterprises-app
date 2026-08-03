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

const dateFromValue = value => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysHeld = item => {
  const start = dateFromValue(item.purchaseDate) || (item.createdAt?.toDate ? item.createdAt.toDate() : null);
  if (!start) return null;

  const end = number(item.salePrice) > 0
    ? (dateFromValue(item.saleDate) || new Date())
    : new Date();

  return Math.max(0, Math.floor((end - start) / 86400000));
};

const buyRating = item => {
  const result = calculation(item);
  const target = number(item.targetProfit) / 100;
  const roi = result.roi;

  if (roi >= Math.max(target, 0.30)) {
    return { label: "Excellent", className: "rating-green" };
  }

  if (roi >= Math.max(target * 0.75, 0.15)) {
    return { label: "Acceptable", className: "rating-yellow" };
  }

  return { label: "Low Margin", className: "rating-red" };
};

const normalizedStatus = value => {
  if (!value || value === "In Inventory") return "Purchased";
  return value;
};

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


function showSyncDetail(message = "") {
  const detail = $("syncDetail");
  if (!detail) return;

  detail.textContent = message;
  detail.hidden = !message;
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
  const heldValues = unsold.map(daysHeld).filter(value => value !== null);
  const averageDaysHeld = heldValues.length
    ? Math.round(heldValues.reduce((sum, value) => sum + value, 0) / heldValues.length)
    : 0;
  const favoriteCount = items.filter(item => item.favorite === true).length;

  const data = [
    ["Items", items.length, "All tracked inventory"],
    ["Sold", sold.length, "Actual sale price entered"],
    ["Inventory Cost", money(unsold.reduce((s,i)=>s+number(i.purchasePrice),0)), "Unsold purchase cost"],
    ["Projected Profit", money(projectedProfit), "Listing price, or expected price if not listed"],
    ["Actual Profit", money(actualProfit), "Completed sales"],
    ["Combined Profit", money(combinedProfit), "Projected + actual"],
    ["Combined ROI", pct(combinedRoi), "Based on purchase cost"],
    ["Average Days Held", averageDaysHeld, "Unsold inventory"],
    ["Favorites", favoriteCount, "High-priority items"]
  ];
  $("metrics").innerHTML = data.map(([label,value,sub]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`).join("");
}

function renderDashboardRows() {
  $("dashboardRows").innerHTML = items.length ? items.map(i => {
    const c = calculation(i);
    return `<tr>
      <td>
        <strong>${i.favorite ? "⭐ " : ""}${escapeHtml(i.brand)} ${escapeHtml(i.itemName)}</strong>
        <span class="muted">${escapeHtml(i.inventoryNumber || "")}</span>
      </td>
      <td><span class="pill ${i.status === "Sold" ? "sold" : i.status === "Listed" ? "listed" : ""}">${escapeHtml(normalizedStatus(i.status))}</span></td>
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
    const haystack = `${i.inventoryNumber || ""} ${i.brand} ${i.itemName} ${i.colorMaterial || ""} ${i.authentication || ""} ${i.purchaseSource} ${i.notes}`.toLowerCase();
    return (!term || haystack.includes(term)) && (!status || i.status === status);
  });


  const sortMode = $("sortFilter")?.value || "updated-desc";

  filtered.sort((a, b) => {
    if (Boolean(b.favorite) !== Boolean(a.favorite)) {
      return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    }

    const aCalc = calculation(a);
    const bCalc = calculation(b);

    switch (sortMode) {
      case "purchase-desc":
        return String(b.purchaseDate || "").localeCompare(String(a.purchaseDate || ""));
      case "purchase-asc":
        return String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || ""));
      case "profit-desc":
        return bCalc.profit - aCalc.profit;
      case "profit-asc":
        return aCalc.profit - bCalc.profit;
      case "brand-asc":
        return String(a.brand || "").localeCompare(String(b.brand || ""));
      case "status-asc":
        return normalizedStatus(a.status).localeCompare(normalizedStatus(b.status));
      default:
        return 0;
    }
  });

  $("emptyItems").hidden = filtered.length > 0;
  $("itemRows").innerHTML = filtered.map(i => {
    const c = calculation(i);
    const rating = buyRating(i);
    const held = daysHeld(i);
    const updated = i.updatedAt?.toDate ? i.updatedAt.toDate().toLocaleString() : "Syncing…";
    return `<tr>
      <td>
        <div class="item-title-line">
          <strong>${i.favorite ? "⭐ " : ""}${escapeHtml(i.brand)}</strong>
          <span class="inventory-number">${escapeHtml(i.inventoryNumber || "Unnumbered")}</span>
        </div>
        <span class="muted">${escapeHtml(i.itemName)}</span>
        <span class="muted">${held === null ? "" : `${held} day${held === 1 ? "" : "s"} held`}</span>
      </td>
      <td>${money(i.purchasePrice)}<span class="muted">${escapeHtml(i.purchaseDate || "")}</span></td>
      <td>${money(i.listingPrice)}<span class="muted">${escapeHtml(i.listingPlatform || "")}</span></td>
      <td>${number(i.salePrice) ? money(i.salePrice) : "—"}<span class="muted">${escapeHtml(i.saleDate || "")}</span></td>
      <td class="${c.profit >= 0 ? "profit-positive" : "profit-negative"}">${money(c.profit)}
        <span class="muted">${c.type}</span>
        <span class="profit-rating ${rating.className}">${rating.label}</span>
      </td>
      <td>${pct(c.roi)}</td>
      <td><span class="pill ${i.status === "Sold" ? "sold" : i.status === "Listed" ? "listed" : ""}">${escapeHtml(normalizedStatus(i.status))}</span></td>
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


function maximumBuyPrice(item) {
  const targetRoi = Math.max(0, number(item.targetProfit) / 100);
  const revenue = number(item.listingPrice) > 0
    ? number(item.listingPrice)
    : number(item.expectedSellingPrice);

  const platform = item.listingPlatform || item.expectedPlatform || "";
  const feeRate = number(estimatedFeeRates[platform]);
  const estimatedFees = revenue * feeRate;
  const sellingCosts = number(item.shippingCosts);
  const buyerShipping = number(item.buyerPaidShipping);

  const availableBeforePurchase =
    revenue +
    buyerShipping -
    estimatedFees -
    sellingCosts;

  return targetRoi >= 0
    ? availableBeforePurchase / (1 + targetRoi)
    : 0;
}

function dealAnalysis(item) {
  const result = calculation(item);
  const maxBuy = maximumBuyPrice(item);
  const purchase = number(item.purchasePrice);
  const targetRoi = number(item.targetProfit) / 100;
  const revenueEntered = result.revenue > 0;

  let recommendation = "Enter pricing details";
  let reason = "Add an expected or listing price, platform, purchase price, and target ROI.";
  let state = "neutral";

  if (revenueEntered && purchase > 0) {
    if (purchase <= maxBuy * 0.90 && result.roi >= Math.max(targetRoi, 0.25)) {
      recommendation = "BUY";
      reason = `Strong margin. Purchase price is ${money(Math.max(0, maxBuy - purchase))} below the maximum buy price.`;
      state = "buy";
    } else if (purchase <= maxBuy && result.roi >= Math.max(targetRoi * 0.80, 0.10)) {
      recommendation = "NEGOTIATE";
      reason = `The deal is close. Stay at or below ${money(maxBuy)} to protect the target ROI.`;
      state = "negotiate";
    } else {
      recommendation = "PASS";
      reason = `Current purchase price is too high for the target return. Maximum recommended buy is ${money(maxBuy)}.`;
      state = "pass";
    }
  }

  const marginScore = Math.max(0, Math.min(45, result.roi * 100));
  const profitScore = Math.max(0, Math.min(35, result.profit / 10));
  const confidenceMap = { High: 20, Medium: 12, Low: 5 };
  const confidenceScore = confidenceMap[item.marketConfidence] ?? 12;
  const score = revenueEntered && purchase > 0
    ? Math.round(Math.min(100, marginScore + profitScore + confidenceScore))
    : null;

  return {
    ...result,
    maxBuy,
    recommendation,
    reason,
    state,
    score
  };
}

function renderDealAnalyzer() {
  const item = readForm();
  const analysis = dealAnalysis(item);
  const card = $("dealAnalyzerCard");

  if (!card) return;

  card.classList.remove("deal-buy", "deal-negotiate", "deal-pass", "deal-neutral");
  card.classList.add(`deal-${analysis.state}`);

  $("dealRecommendation").textContent = analysis.recommendation;
  $("dealReason").textContent = analysis.reason;
  $("dealScore").textContent = analysis.score === null ? "—" : `${analysis.score}/100`;
  $("dealRevenue").textContent = money(analysis.revenue);
  $("dealFees").textContent = money(analysis.fee);
  $("dealCosts").textContent = money(number(item.shippingCosts));
  $("dealMaxBuy").textContent = money(analysis.maxBuy);
  $("dealProfit").textContent = money(analysis.profit);
  $("dealRoi").textContent = pct(analysis.roi);

  if ($("recommendedMaxBuy")) {
    $("recommendedMaxBuy").value = analysis.maxBuy > 0
      ? analysis.maxBuy.toFixed(2)
      : "";
  }
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
  renderDealAnalyzer();
}

function readForm() {
  const fields = ["inventoryNumber","favorite","brand","customBrand","itemName","category","status","colorMaterial","condition","accessories","authentication",
    "purchaseDate","purchaseSource","purchasePrice","targetProfit","expectedPlatform","expectedSellingPrice",
    "recommendedMaxBuy","marketConfidence","listingDate","listingPlatform","listingPrice","salePrice","saleDate",
    "actualPlatformFee","shippingCosts","buyerPaidShipping","notes","pricingAnalysis"];
  return Object.fromEntries(fields.map(id => [id, $(id).value]));
}

function setForm(item = null) {
  const isEditing = Boolean(item && item.id);

  const defaults = {
    inventoryNumber: "",
    favorite: "false",
    brand: "",
    customBrand: "",
    itemName: "",
    category: "Handbag",
    status: "Purchased",
    colorMaterial: "",
    condition: "Excellent",
    accessories: "",
    authentication: "Not authenticated",
    purchaseDate: "",
    purchaseSource: "",
    purchasePrice: "",
    targetProfit: "25",
    expectedPlatform: "",
    expectedSellingPrice: "",
    recommendedMaxBuy: "",
    marketConfidence: "Medium",
    listingDate: "",
    listingPlatform: "",
    listingPrice: "",
    salePrice: "",
    saleDate: "",
    actualPlatformFee: "",
    shippingCosts: "0",
    buyerPaidShipping: "0",
    notes: "",
    pricingAnalysis: ""
  };

  const values = isEditing
    ? {
        ...defaults,
        ...item,
        status: normalizedStatus(item.status || defaults.status),
        favorite: item.favorite === true ? "true" : "false"
      }
    : { ...defaults };

  const brandSelect = $("brand");
  const knownBrands = brandSelect
    ? Array.from(brandSelect.options).map(option => option.value)
    : [];

  if (isEditing && values.brand && !knownBrands.includes(values.brand)) {
    values.customBrand = values.brand;
    values.brand = "Other";
  }

  Object.keys(defaults).forEach(key => {
    const element = $(key);
    if (!element) return;

    element.value = values[key] ?? "";
  });

  $("editId").value = isEditing ? item.id : "";
  $("formTitle").textContent = isEditing ? "Edit Item" : "Add Item";
  $("deleteCurrentBtn").hidden = !isEditing;
  $("formMessage").className = "message";
  $("formMessage").textContent = "";

  if ($("customBrandWrap")) {
    $("customBrandWrap").hidden = $("brand")?.value !== "Other";
  }

  previewProfit();
}

async function saveItem(event) {
  event.preventDefault();

  if (saveInProgress) return;

  const submitButtons = Array.from(
    document.querySelectorAll('#itemForm button[type="submit"]')
  );

  const restoreSaveButtons = () => {
    submitButtons.forEach(button => {
      button.disabled = false;
      button.textContent =
        button.dataset.originalText || "Save Item";
    });
  };

  saveInProgress = true;

  submitButtons.forEach(button => {
    button.dataset.originalText =
      button.dataset.originalText || button.textContent;

    button.disabled = true;
    button.textContent = "Saving…";
  });

  $("formMessage").className = "message";
  $("formMessage").textContent = "Saving…";

  try {
    const data = readForm();

    if (data.brand === "Other") {
      data.brand = data.customBrand.trim();
    }

    if (!data.brand.trim()) {
      throw new Error("Please select or enter a brand.");
    }

    if (!data.itemName.trim()) {
      throw new Error("Please enter an item or model name.");
    }

    if (
      data.purchasePrice === "" ||
      number(data.purchasePrice) < 0
    ) {
      throw new Error("Please enter a valid purchase price.");
    }

    if (!auth.currentUser) {
      throw new Error("Your login session expired. Sign in again.");
    }

    if (number(data.salePrice) > 0) {
      data.status = "Sold";
    }

    data.favorite =
      String(data.favorite) === "true";

    data.status =
      normalizedStatus(data.status);

    data.purchasePrice =
      number(data.purchasePrice);

    data.targetProfit =
      number(data.targetProfit);

    data.expectedSellingPrice =
      number(data.expectedSellingPrice);

    data.recommendedMaxBuy =
      number(data.recommendedMaxBuy);

    data.listingPrice =
      number(data.listingPrice);

    data.salePrice =
      number(data.salePrice);

    data.actualPlatformFee =
      number(data.actualPlatformFee);

    data.shippingCosts =
      number(data.shippingCosts);

    data.buyerPaidShipping =
      number(data.buyerPaidShipping);

    delete data.customBrand;

    data.updatedAt = serverTimestamp();
    data.updatedBy = auth.currentUser.email;

    const saveOperation = async () => {
      const id = $("editId").value;

      if (id) {
        await updateDoc(
          doc(
            db,
            "Workspaces",
            WORKSPACE_ID,
            "items",
            id
          ),
          data
        );
      } else {
        const nextSequence =
          items.reduce((highest, item) => {
            const match = String(
              item.inventoryNumber || ""
            ).match(/AE-(\d+)/i);

            return match
              ? Math.max(highest, Number(match[1]))
              : highest;
          }, 0) + 1;

        data.inventoryNumber =
          `AE-${String(nextSequence).padStart(4, "0")}`;

        data.createdAt = serverTimestamp();
        data.createdBy = auth.currentUser.email;

        await addDoc(itemCollection(), data);
      }
    };

    const timeout = new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              "Firebase did not respond within 15 seconds. Check your internet connection and try again."
            )
          ),
        15000
      );
    });

    await Promise.race([
      saveOperation(),
      timeout
    ]);

    $("formMessage").className = "message ok";
    $("formMessage").textContent =
      "Saved and synced successfully.";

    setForm(null);
    showTab("items");
  } catch (error) {
    console.error(error);

    $("formMessage").className =
      "message error";

    $("formMessage").textContent =
      friendlyError(error);
  } finally {
    saveInProgress = false;
    restoreSaveButtons();
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
  showSyncDetail("");
  const q = query(itemCollection(), orderBy("updatedAt", "desc"));
  unsubscribeItems = onSnapshot(q, snapshot => {
    items = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
    $("syncBadge").textContent = navigator.onLine ? "Cloud synced" : "Offline";
    renderAll();
  }, error => {
    setSyncState("error", "Sync error");
      showSyncDetail(`Firestore sync failed: ${friendlyError(error)}`);
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
    setForm(null);
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


$("signOutBtn").onclick = $("settingsSignOutBtn").onclick = () => signOut(auth);
$("itemForm").addEventListener("submit", saveItem);
$("cancelEditBtn").onclick = () => { setForm(); showTab("items"); };
$("newItemBtn").onclick = () => { setForm(); showTab("add"); };
$("deleteCurrentBtn").onclick = () => removeItem($("editId").value);
$("searchInput").addEventListener("input", renderItems);
$("statusFilter").addEventListener("change", renderItems);
if ($("sortFilter")) $("sortFilter").addEventListener("change", renderItems);
document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
["purchasePrice","expectedSellingPrice","listingPrice","salePrice","actualPlatformFee","shippingCosts","buyerPaidShipping","expectedPlatform","listingPlatform"]
  .forEach(id => $(id).addEventListener("input", previewProfit));

window.addEventListener("online", () => $("syncBadge").textContent = "Reconnecting…");
window.addEventListener("offline", () => $("syncBadge").textContent = "Offline");

populatePlatforms();
previewProfit();
