import { firebaseConfig, WORKSPACE_ID, OWNER_EMAIL } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, setDoc,
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
let unsubscribeTeamMembers = null;
let unsubscribeAccessRequests = null;
let currentMember = null;
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

const workspaceDoc = () => doc(db, "Workspaces", WORKSPACE_ID);
const itemCollection = () => collection(db, "Workspaces", WORKSPACE_ID, "items");
const membersCollection = () => collection(db, "Workspaces", WORKSPACE_ID, "members");
const accessRequestsCollection = () => collection(db, "Workspaces", WORKSPACE_ID, "accessRequests");
const memberDoc = uid => doc(db, "Workspaces", WORKSPACE_ID, "members", uid);
const accessRequestDoc = uid => doc(db, "Workspaces", WORKSPACE_ID, "accessRequests", uid);

const isTeamAdmin = member =>
  ["owner", "admin"].includes(String(member?.role || "").toLowerCase());

const roleLabel = role => ({
  owner: "Owner",
  admin: "Admin",
  "inventory-manager": "Inventory Manager",
  viewer: "Viewer"
}[String(role || "").toLowerCase()] || role || "Member");

const normalizeEmail = value =>
  String(value || "").trim().toLowerCase();

const isConfiguredOwnerEmail = email =>
  normalizeEmail(email) === normalizeEmail(OWNER_EMAIL);

async function ensureOwnerMember(user) {
  if (!user || !isConfiguredOwnerEmail(user.email)) {
    return null;
  }

  const ownerReference = memberDoc(user.uid);
  const existing = await getDoc(ownerReference);

  if (existing.exists()) {
    return {
      id: existing.id,
      ...existing.data()
    };
  }

  const ownerMember = {
    uid: user.uid,
    displayName: "Matthew Auman",
    email: normalizeEmail(user.email),
    role: "owner",
    active: true,
    approvedAt: serverTimestamp(),
    approvedBy: "owner-bootstrap"
  };

  await setDoc(ownerReference, ownerMember, { merge: true });

  return {
    id: user.uid,
    ...ownerMember
  };
}


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
    return "Too many attempts. Wait a few minutes and try again.";
  }

  if (code.includes("auth/email-already-in-use")) {
    return "An account already exists for that email. Use Sign In or Forgot password.";
  }

  if (code.includes("auth/weak-password")) {
    return "Choose a stronger password with at least 8 characters.";
  }

  if (code.includes("auth/invalid-email")) {
    return "Enter a valid email address.";
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


function splitCustomValues(value) {
  return String(value || "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function toggleOtherField(selectId, wrapId, inputId) {
  const select = $(selectId);
  const wrap = $(wrapId);
  const input = $(inputId);

  if (!select || !wrap || !input) return;

  const isOther = select.value === "Other";
  wrap.hidden = !isOther;

  if (!isOther) {
    input.value = "";
  }
}

function setupOtherSelect(selectId, wrapId, inputId) {
  const select = $(selectId);
  if (!select) return;

  select.addEventListener("change", () => {
    toggleOtherField(selectId, wrapId, inputId);
    previewProfit();
  });

  toggleOtherField(selectId, wrapId, inputId);
}

function populatePlatforms() {
  ["expectedPlatform", "actualSalePlatform"].forEach(id => {
    const element = $(id);
    if (!element) return;

    element.innerHTML = platforms
      .map(
        platform =>
          `<option value="${platform}">${platform || "Select platform"}</option>`
      )
      .join("");
  });

  const listingContainer = $("listingPlatforms");

  if (listingContainer) {
    const listingChoices = platforms.filter(Boolean);

    listingContainer.innerHTML = listingChoices
      .map(
        platform => `
          <button
            type="button"
            class="platform-toggle"
            data-platform="${escapeHtml(platform)}"
            aria-pressed="false"
          >
            <span class="platform-toggle-check">✓</span>
            <span>${escapeHtml(platform)}</span>
          </button>
        `
      )
      .join("");

    listingContainer
      .querySelectorAll(".platform-toggle")
      .forEach(button => {
        button.addEventListener("click", () => {
          const isSelected =
            button.getAttribute("aria-pressed") === "true";

          button.setAttribute(
            "aria-pressed",
            isSelected ? "false" : "true"
          );

          button.classList.toggle(
            "selected",
            !isSelected
          );

          const platform =
            button.dataset.platform || "";

          if (platform === "Other") {
            const wrap =
              $("customListingPlatformWrap");

            if (wrap) {
              wrap.hidden = isSelected;
            }

            if (
              isSelected &&
              $("customListingPlatform")
            ) {
              $("customListingPlatform").value = "";
            }
          }

          updateListingPlatformSummary();
          previewProfit();
        });
      });
  }

  updateListingPlatformSummary();

  setupOtherSelect(
    "expectedPlatform",
    "customExpectedPlatformWrap",
    "customExpectedPlatform"
  );

  setupOtherSelect(
    "actualSalePlatform",
    "customActualSalePlatformWrap",
    "customActualSalePlatform"
  );

  setupOtherSelect(
    "category",
    "customCategoryWrap",
    "customCategory"
  );
}

function getSelectedListingPlatforms() {
  const selected = Array.from(
    document.querySelectorAll(
      '.platform-toggle[aria-pressed="true"]'
    )
  ).map(button => button.dataset.platform || "");

  const customPlatforms = splitCustomValues(
    $("customListingPlatform")?.value
  );

  return selected
    .filter(platform => platform && platform !== "Other")
    .concat(customPlatforms);
}

function updateListingPlatformSummary() {
  const summary = $("listingPlatformsSummary");
  if (!summary) return;

  const selected = getSelectedListingPlatforms();
  const otherChecked = document.querySelector(
    '.platform-toggle[data-platform="Other"][aria-pressed="true"]'
  );

  const visibleSelected = selected.length
    ? selected
    : otherChecked
      ? ["Other — enter details below"]
      : [];

  summary.textContent = visibleSelected.length
    ? `Selected: ${visibleSelected.join(", ")}`
    : "No platforms selected";
}

function setSelectedListingPlatforms(values) {
  const normalized = Array.isArray(values)
    ? values
    : values
      ? [values]
      : [];

  const knownChoices = platforms.filter(Boolean);
  const customValues = normalized.filter(
    value => !knownChoices.includes(value)
  );

  document
    .querySelectorAll(".platform-toggle")
    .forEach(button => {
      const platform = button.dataset.platform || "";
      const selected =
        platform === "Other"
          ? customValues.length > 0
          : normalized.includes(platform);

      button.setAttribute(
        "aria-pressed",
        selected ? "true" : "false"
      );

      button.classList.toggle(
        "selected",
        selected
      );
    });

  if ($("customListingPlatform")) {
    $("customListingPlatform").value =
      customValues.join(", ");
  }

  if ($("customListingPlatformWrap")) {
    $("customListingPlatformWrap").hidden =
      customValues.length === 0;
  }

  updateListingPlatformSummary();
}

function calculation(i) {
  const purchase = number(i.purchasePrice);
  const shippingCosts = number(i.shippingCosts);
  const buyerShipping = number(i.buyerPaidShipping);
  const saleEntered = number(i.salePrice) > 0;
  const listingEntered = number(i.listingPrice) > 0;

  const revenue = saleEntered ? number(i.salePrice) : (listingEntered ? number(i.listingPrice) : number(i.expectedSellingPrice));
  const listingPlatforms = Array.isArray(i.listingPlatforms)
    ? i.listingPlatforms
    : i.listingPlatform
      ? [i.listingPlatform]
      : [];

  const platform = saleEntered
    ? (
        i.actualSalePlatform ||
        i.expectedPlatform ||
        listingPlatforms[0] ||
        ""
      )
    : (
        i.expectedPlatform ||
        listingPlatforms[0] ||
        ""
      );
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
    const haystack = `${i.inventoryNumber || ""} ${i.brand} ${i.itemName} ${i.colorMaterial || ""} ${i.authentication || ""} ${(Array.isArray(i.listingPlatforms) ? i.listingPlatforms.join(" ") : (i.listingPlatform || ""))} ${i.purchaseSource} ${i.notes}`.toLowerCase();
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
      <td>${money(i.listingPrice)}
      <span class="muted">${escapeHtml(
        Array.isArray(i.listingPlatforms)
          ? i.listingPlatforms.join(", ")
          : (i.listingPlatform || "")
      )}</span></td>
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

  const listingPlatforms = Array.isArray(item.listingPlatforms)
    ? item.listingPlatforms
    : item.listingPlatform
      ? [item.listingPlatform]
      : [];

  const platform =
    item.expectedPlatform ||
    listingPlatforms[0] ||
    "";
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
  const fields = ["inventoryNumber","favorite","brand","customBrand","itemName","category","customCategory","status","colorMaterial","condition","accessories","authentication",
    "purchaseDate","purchaseSource","purchasePrice","targetProfit","expectedPlatform","customExpectedPlatform","expectedSellingPrice",
    "recommendedMaxBuy","marketConfidence","listingDate","listingPrice","salePrice","saleDate","actualSalePlatform","customActualSalePlatform",
    "actualPlatformFee","shippingCosts","buyerPaidShipping","notes","pricingAnalysis"];
  const data = Object.fromEntries(
    fields.map(id => [id, $(id)?.value ?? ""])
  );

  data.listingPlatforms = getSelectedListingPlatforms();

  return data;
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
    customCategory: "",
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
    customExpectedPlatform: "",
    expectedSellingPrice: "",
    recommendedMaxBuy: "",
    marketConfidence: "Medium",
    listingDate: "",
    listingPlatforms: [],
    actualSalePlatform: "",
    customActualSalePlatform: "",
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

  const knownCategories = [
    "Handbag",
    "Wallet",
    "Accessory",
    "Luggage",
    "Clothing",
    "Shoes",
    "Other"
  ];

  if (
    isEditing &&
    values.category &&
    !knownCategories.includes(values.category)
  ) {
    values.customCategory = values.category;
    values.category = "Other";
  }

  const knownPlatforms = platforms.filter(Boolean);

  if (
    isEditing &&
    values.expectedPlatform &&
    !knownPlatforms.includes(values.expectedPlatform)
  ) {
    values.customExpectedPlatform = values.expectedPlatform;
    values.expectedPlatform = "Other";
  }

  if (
    isEditing &&
    values.actualSalePlatform &&
    !knownPlatforms.includes(values.actualSalePlatform)
  ) {
    values.customActualSalePlatform = values.actualSalePlatform;
    values.actualSalePlatform = "Other";
  }

  Object.keys(defaults).forEach(key => {
    const element = $(key);
    if (!element) return;

    element.value = values[key] ?? "";
  });

  const existingListingPlatforms = Array.isArray(values.listingPlatforms)
    ? values.listingPlatforms
    : values.listingPlatform
      ? [values.listingPlatform]
      : [];

  setSelectedListingPlatforms(existingListingPlatforms);

  $("editId").value = isEditing ? item.id : "";
  $("formTitle").textContent = isEditing ? "Edit Item" : "Add Item";
  $("deleteCurrentBtn").hidden = !isEditing;
  $("formMessage").className = "message";
  $("formMessage").textContent = "";

  if ($("customBrandWrap")) {
    $("customBrandWrap").hidden = $("brand")?.value !== "Other";
  }

  toggleOtherField(
    "category",
    "customCategoryWrap",
    "customCategory"
  );

  toggleOtherField(
    "expectedPlatform",
    "customExpectedPlatformWrap",
    "customExpectedPlatform"
  );

  toggleOtherField(
    "actualSalePlatform",
    "customActualSalePlatformWrap",
    "customActualSalePlatform"
  );

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

    if (data.category === "Other") {
      data.category = data.customCategory.trim();
    }

    if (data.expectedPlatform === "Other") {
      data.expectedPlatform =
        data.customExpectedPlatform.trim();
    }

    if (data.actualSalePlatform === "Other") {
      data.actualSalePlatform =
        data.customActualSalePlatform.trim();
    }

    if (!data.brand.trim()) {
      throw new Error("Please select or enter a brand.");
    }

    if (!data.itemName.trim()) {
      throw new Error("Please enter an item or model name.");
    }

    if (!data.category.trim()) {
      throw new Error("Please enter the Other category.");
    }

    const otherListingChecked = document.querySelector(
      '.platform-toggle[data-platform="Other"][aria-pressed="true"]'
    );

    if (
      otherListingChecked &&
      splitCustomValues($("customListingPlatform")?.value).length === 0
    ) {
      throw new Error(
        "Please enter the Other listing platform."
      );
    }

    if (
      $("expectedPlatform")?.value === "Other" &&
      !data.expectedPlatform.trim()
    ) {
      throw new Error(
        "Please enter the Other expected platform."
      );
    }

    if (
      $("actualSalePlatform")?.value === "Other" &&
      !data.actualSalePlatform.trim()
    ) {
      throw new Error(
        "Please enter the Other actual sale platform."
      );
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
    delete data.customCategory;
    delete data.customExpectedPlatform;
    delete data.customActualSalePlatform;
    delete data.listingPlatform;

    if (!Array.isArray(data.listingPlatforms)) {
      data.listingPlatforms = [];
    }

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


function stopTeamListeners() {
  if (unsubscribeTeamMembers) {
    unsubscribeTeamMembers();
    unsubscribeTeamMembers = null;
  }

  if (unsubscribeAccessRequests) {
    unsubscribeAccessRequests();
    unsubscribeAccessRequests = null;
  }
}

function renderTeamMembers(members) {
  const list = $("teamMembersList");
  if (!list) return;

  if (!members.length) {
    list.innerHTML = '<div class="empty">No approved team members.</div>';
    return;
  }

  list.innerHTML = members
    .sort((a, b) =>
      String(a.displayName || a.email || "")
        .localeCompare(String(b.displayName || b.email || ""))
    )
    .map(member => `
      <div class="team-row">
        <div>
          <strong>${escapeHtml(member.displayName || member.email || "Team Member")}</strong>
          <span class="muted">${escapeHtml(member.email || "")}</span>
        </div>
        <span class="role-pill">${escapeHtml(roleLabel(member.role))}</span>
      </div>
    `)
    .join("");
}

function renderPendingRequests(requests) {
  const list = $("pendingRequestsList");
  if (!list) return;

  const pending = requests.filter(
    request => String(request.status || "pending").toLowerCase() === "pending"
  );

  if (!pending.length) {
    list.innerHTML = '<div class="empty">No pending requests.</div>';
    return;
  }

  list.innerHTML = pending.map(request => `
    <div class="team-request" data-request-id="${escapeHtml(request.id)}">
      <div class="team-request-person">
        <strong>${escapeHtml(request.displayName || "New User")}</strong>
        <span class="muted">${escapeHtml(request.email || "")}</span>
      </div>

      <select class="request-role-select" aria-label="Select role">
        <option value="inventory-manager">Inventory Manager</option>
        <option value="viewer">Viewer</option>
        <option value="admin">Admin</option>
      </select>

      <div class="row-actions">
        <button type="button" class="primary approve-request-btn" data-id="${escapeHtml(request.id)}">Approve</button>
        <button type="button" class="danger deny-request-btn" data-id="${escapeHtml(request.id)}">Deny</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".approve-request-btn").forEach(button => {
    button.addEventListener("click", async () => {
      const requestId = button.dataset.id;
      const row = button.closest(".team-request");
      const role = row.querySelector(".request-role-select").value;
      const request = pending.find(item => item.id === requestId);
      if (!request) return;

      button.disabled = true;
      $("teamMessage").className = "message";
      $("teamMessage").textContent = "Approving user…";

      try {
        await setDoc(memberDoc(requestId), {
          uid: requestId,
          displayName: request.displayName || "",
          email: request.email || "",
          role,
          active: true,
          approvedAt: serverTimestamp(),
          approvedBy: auth.currentUser?.email || ""
        }, { merge: true });

        await updateDoc(accessRequestDoc(requestId), {
          status: "approved",
          approvedAt: serverTimestamp(),
          approvedBy: auth.currentUser?.email || "",
          approvedRole: role
        });

        $("teamMessage").className = "message ok";
        $("teamMessage").textContent =
          `${request.displayName || request.email} was approved as ${roleLabel(role)}.`;
      } catch (error) {
        $("teamMessage").className = "message error";
        $("teamMessage").textContent = friendlyError(error);
      } finally {
        button.disabled = false;
      }
    });
  });

  list.querySelectorAll(".deny-request-btn").forEach(button => {
    button.addEventListener("click", async () => {
      const requestId = button.dataset.id;
      const request = pending.find(item => item.id === requestId);
      if (!request) return;

      if (!confirm(`Deny access for ${request.displayName || request.email}?`)) {
        return;
      }

      try {
        await updateDoc(accessRequestDoc(requestId), {
          status: "denied",
          deniedAt: serverTimestamp(),
          deniedBy: auth.currentUser?.email || ""
        });

        $("teamMessage").className = "message ok";
        $("teamMessage").textContent = "Access request denied.";
      } catch (error) {
        $("teamMessage").className = "message error";
        $("teamMessage").textContent = friendlyError(error);
      }
    });
  });
}

function startTeamManagement() {
  stopTeamListeners();

  const card = $("teamManagementCard");
  const allowed = isTeamAdmin(currentMember);

  if (card) card.hidden = !allowed;
  if (!allowed) return;

  unsubscribeTeamMembers = onSnapshot(
    membersCollection(),
    snapshot => {
      const members = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      renderTeamMembers(members);
    },
    error => {
      $("teamMessage").className = "message error";
      $("teamMessage").textContent = friendlyError(error);
    }
  );

  unsubscribeAccessRequests = onSnapshot(
    accessRequestsCollection(),
    snapshot => {
      const requests = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      renderPendingRequests(requests);
    },
    error => {
      $("teamMessage").className = "message error";
      $("teamMessage").textContent = friendlyError(error);
    }
  );
}

function showAuthView(view) {
  const signingIn = view === "signin";
  $("authForm").hidden = !signingIn;
  $("showRequestAccessBtn").hidden = !signingIn;
  $("forgotPasswordBtn").hidden = !signingIn;
  $("requestAccessForm").hidden = signingIn;
  $("authMessage").className = "message";
  $("authMessage").textContent = "";
}

async function loadMemberAccess(user) {
  const snapshot = await getDoc(memberDoc(user.uid));

  if (snapshot.exists()) {
    const member = {
      id: snapshot.id,
      ...snapshot.data()
    };

    return member.active === false ? null : member;
  }

  // One-time recovery when the owner's Firebase UID changes.
  if (isConfiguredOwnerEmail(user.email)) {
    return ensureOwnerMember(user);
  }

  return null;
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

onAuthStateChanged(auth, async user => {
  if (unsubscribeItems) {
    unsubscribeItems();
    unsubscribeItems = null;
  }

  stopTeamListeners();
  items = [];
  currentMember = null;

  if (!user) {
    $("authScreen").hidden = false;
    $("pendingScreen").hidden = true;
    $("appShell").hidden = true;
    showAuthView("signin");
    return;
  }

  $("authScreen").hidden = true;
  $("appShell").hidden = true;
  $("pendingScreen").hidden = true;

  try {
    currentMember = await loadMemberAccess(user);

    if (!currentMember) {
      $("pendingScreen").hidden = false;
      $("pendingEmail").textContent = user.email || "";
      $("pendingMessage").className = "message";
      $("pendingMessage").textContent =
        "Your sign-in worked. This account is waiting for workspace approval.";
      return;
    }

    $("appShell").hidden = false;
    $("currentUser").textContent =
      `Signed in as ${currentMember.displayName || user.email} · ${roleLabel(currentMember.role)}`;

    setSyncState("syncing", "Connecting…");
    startItemSync();
    startTeamManagement();
    setForm(null);
  } catch (error) {
    $("authScreen").hidden = false;
    $("pendingScreen").hidden = true;
    $("appShell").hidden = true;
    $("authMessage").className = "message error";
    $("authMessage").textContent = friendlyError(error);
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

$("showRequestAccessBtn").addEventListener("click", () => {
  showAuthView("request");
});

$("cancelRequestAccessBtn").addEventListener("click", () => {
  showAuthView("signin");
});

$("requestAccessForm").addEventListener("submit", async event => {
  event.preventDefault();

  const displayName = $("requestName").value.trim();
  const email = $("requestEmail").value.trim().toLowerCase();
  const password = $("requestPassword").value;
  const confirmation = $("requestPasswordConfirm").value;

  if (!displayName) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = "Enter your name.";
    return;
  }

  if (password !== confirmation) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = "The passwords do not match.";
    return;
  }

  if (password.length < 8) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = "Use a password with at least 8 characters.";
    return;
  }

  $("authMessage").className = "message";
  $("authMessage").textContent = "Creating account…";

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await setDoc(accessRequestDoc(credential.user.uid), {
      uid: credential.user.uid,
      displayName,
      email,
      status: "pending",
      requestedAt: serverTimestamp()
    });

    $("authMessage").className = "message ok";
    $("authMessage").textContent =
      "Account created. Your access request is waiting for approval.";
  } catch (error) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = friendlyError(error);
  }
});

$("forgotPasswordBtn").addEventListener("click", async () => {
  const email =
    $("authEmail").value.trim() ||
    prompt("Enter the email address for the account:");

  if (!email) return;

  $("authMessage").className = "message";
  $("authMessage").textContent = "Sending password reset email…";

  try {
    await sendPasswordResetEmail(auth, email);
    $("authMessage").className = "message ok";
    $("authMessage").textContent =
      "Password reset email sent. Check the inbox and spam folder.";
  } catch (error) {
    $("authMessage").className = "message error";
    $("authMessage").textContent = friendlyError(error);
  }
});

$("pendingSignOutBtn").addEventListener("click", () => signOut(auth));


$("signOutBtn").onclick = $("settingsSignOutBtn").onclick = () => signOut(auth);
$("itemForm").addEventListener("submit", saveItem);
$("cancelEditBtn").onclick = () => { setForm(); showTab("items"); };
$("newItemBtn").onclick = () => { setForm(); showTab("add"); };
$("deleteCurrentBtn").onclick = () => removeItem($("editId").value);
$("searchInput").addEventListener("input", renderItems);
$("statusFilter").addEventListener("change", renderItems);
if ($("sortFilter")) $("sortFilter").addEventListener("change", renderItems);
document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
["purchasePrice","expectedSellingPrice","listingPrice","salePrice","actualPlatformFee","shippingCosts","buyerPaidShipping","expectedPlatform","actualSalePlatform"]
  .forEach(id => $(id).addEventListener("input", previewProfit));

window.addEventListener("online", () => $("syncBadge").textContent = "Reconnecting…");
window.addEventListener("offline", () => $("syncBadge").textContent = "Offline");

populatePlatforms();
previewProfit();
