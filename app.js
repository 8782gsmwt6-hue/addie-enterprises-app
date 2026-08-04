import { firebaseConfig, WORKSPACE_ID, OWNER_EMAIL } from "./firebase-config.js";
import { inventoryImportRecords } from "./inventory-import-data.js";
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



const helpContent = {

  itemType: {
    title: "Type",
    body: `
      <p><strong>What it means:</strong> The functional product type, such as Tote, Crossbody, Wallet, Clutch, or Sunglasses.</p>
      <p><strong>Why it matters:</strong> Type makes filtering and profitability analysis much more useful.</p>
      <p><strong>Source:</strong> User-entered or imported from the item description.</p>
    `
  },

  color: {
    title: "Color",
    body: `
      <p><strong>What it means:</strong> The item's primary visible color.</p>
      <p><strong>Tip:</strong> Use the dominant color. Add secondary colors in Notes when needed.</p>
      <p><strong>Source:</strong> User-entered or imported from the item description.</p>
    `
  },

  materialPattern: {
    title: "Material / Pattern",
    body: `
      <p><strong>What it means:</strong> The material, signature canvas, weave, or recognizable pattern.</p>
      <p><strong>Examples:</strong> Saffiano, Intrecciato, Monogram Canvas, House Check, Zucca, Calfskin, or Patent Leather.</p>
      <p><strong>Why it matters:</strong> Material and pattern can materially affect resale value and demand.</p>
      <p><strong>Source:</strong> User-entered or imported from the item description.</p>
    `
  },


  size: {
    title: "Size",
    body: `
      <p><strong>What it means:</strong> The manufacturer's size, model size, measurement, or shoe size.</p>
      <p><strong>Examples:</strong> Neverfull MM, Speedy 30, Alma BB, Kelly 28, shoe size 38, or belt size 95 cm.</p>
      <p><strong>Why it matters:</strong> Size often affects resale value, buyer demand, and searchability.</p>
      <p><strong>Source:</strong> User-entered or imported from the item description.</p>
    `
  },

  purchasePrice: {
    title: "Purchase Price",
    body: `
      <p><strong>What it means:</strong> The total amount paid, or expected to be paid, to acquire the item.</p>
      <p><strong>What to enter:</strong> Include the item cost and any unavoidable acquisition costs already known, such as buyer premiums or inbound shipping.</p>
      <p><strong>Why it matters:</strong> Purchase price is the investment used to calculate profit and ROI.</p>
      <p><strong>Source:</strong> User-entered.</p>
    `
  },

  expectedSellingPrice: {
    title: "Expected Selling Price",
    body: `
      <p><strong>What it means:</strong> The realistic price you believe the item will actually sell for.</p>
      <p><strong>What to enter:</strong> Use recent sold comparisons when available, not just active asking prices.</p>
      <p><strong>Why it matters:</strong> This value drives projected revenue, estimated fees, projected profit, and maximum recommended buy price.</p>
      <p><strong>Source:</strong> User-entered estimate. The app does not yet research live sold listings automatically.</p>
    `
  },

  expectedPlatform: {
    title: "Expected Sale Platform",
    body: `
      <p><strong>What it means:</strong> The marketplace most likely to produce the sale.</p>
      <p><strong>Why it matters:</strong> The app uses the selected platform's estimated fee rate when calculating projected profit.</p>
      <p><strong>Current assumptions:</strong> For example, the app currently estimates approximately 15% for eBay and 20% for Poshmark.</p>
      <p><strong>Source:</strong> User selection plus the app's configured fee assumptions.</p>
    `
  },

  targetRoi: {
    title: "Target ROI",
    body: `
      <p><strong>What it means:</strong> The minimum return you want to earn compared with the amount invested.</p>
      <p><strong>Formula:</strong> Profit ÷ Purchase Price × 100.</p>
      <p><strong>Example:</strong> A $100 profit on a $400 purchase equals a 25% ROI.</p>
      <p><strong>Why it matters:</strong> A higher target ROI lowers the maximum amount the app recommends paying.</p>
      <p><strong>Source:</strong> User-entered goal.</p>
    `
  },

  shippingCosts: {
    title: "Shipping / Selling Costs",
    body: `
      <p><strong>What it means:</strong> Costs paid by Addie Enterprises to complete the sale.</p>
      <p><strong>Examples:</strong> Shipping label, packaging, authentication, cleaning, repair, or consignment-related costs.</p>
      <p><strong>Why it matters:</strong> These costs reduce net proceeds and profit dollar-for-dollar.</p>
      <p><strong>Source:</strong> User-entered.</p>
    `
  },

  buyerPaidShipping: {
    title: "Buyer-paid Shipping",
    body: `
      <p><strong>What it means:</strong> Shipping money collected from the buyer.</p>
      <p><strong>When to use it:</strong> Enter an amount only when the buyer's shipping payment becomes part of your proceeds.</p>
      <p><strong>Why it matters:</strong> This amount increases projected or actual net proceeds.</p>
      <p><strong>Source:</strong> User-entered.</p>
    `
  },

  marketConfidence: {
    title: "Market Confidence",
    body: `
      <p><strong>High:</strong> Several recent, closely matched sold listings support the estimate.</p>
      <p><strong>Medium:</strong> Some comparable information exists, but there are meaningful differences or limited sales.</p>
      <p><strong>Low:</strong> Few reliable sold comparisons exist, or the item is rare, unusual, or difficult to identify.</p>
      <p><strong>Why it matters:</strong> Confidence affects the Opportunity Score, but it does not change the underlying fee calculation.</p>
      <p><strong>Source:</strong> User judgment.</p>
    `
  },

  condition: {
    title: "Condition",
    body: `
      <p><strong>What it means:</strong> The item's current physical state.</p>
      <p><strong>What to consider:</strong> Exterior wear, corner wear, handles, straps, interior condition, odor, hardware, stains, cracks, repairs, and missing pieces.</p>
      <p><strong>Why it matters:</strong> Condition should influence the expected selling price and market confidence.</p>
      <p><strong>Source:</strong> User assessment.</p>
    `
  },

  actualPlatformFee: {
    title: "Actual Platform Fee",
    body: `
      <p><strong>What it means:</strong> The real fee charged by the marketplace after the item sells.</p>
      <p><strong>When to enter it:</strong> Replace the estimated fee with the exact amount shown in the final sale statement.</p>
      <p><strong>Why it matters:</strong> Once a sale price is entered, the app uses this actual fee to calculate actual profit.</p>
      <p><strong>Source:</strong> Marketplace sale statement.</p>
    `
  },

  listingPrice: {
    title: "Listing Price",
    body: `
      <p><strong>What it means:</strong> The public asking price currently shown on the marketplace.</p>
      <p><strong>How the app uses it:</strong> Before an item sells, Listing Price becomes the projected revenue basis when it is entered.</p>
      <p><strong>Important:</strong> Listing price is not the same as expected accepted-offer price. Use a realistic number when evaluating profitability.</p>
      <p><strong>Source:</strong> User-entered.</p>
    `
  },

  salePrice: {
    title: "Sale Price",
    body: `
      <p><strong>What it means:</strong> The actual amount the buyer paid for the item, before subtracting fees and costs.</p>
      <p><strong>How the app uses it:</strong> Once entered, the app switches from projected profit to actual profit.</p>
      <p><strong>Source:</strong> Final marketplace or direct-sale transaction.</p>
    `
  },

  authentication: {
    title: "Authentication",
    body: `
      <p><strong>What it means:</strong> Whether the item has been reviewed by an authentication service or other trusted method.</p>
      <p><strong>Why it matters:</strong> Authentication may increase buyer confidence, reduce disputes, and sometimes support a stronger selling price.</p>
      <p><strong>Important:</strong> The app records the status but does not authenticate products itself.</p>
      <p><strong>Source:</strong> User-entered documentation or authentication result.</p>
    `
  },

  maximumBuy: {
    title: "Maximum Recommended Buy",
    body: `
      <p><strong>What it means:</strong> The highest purchase price that still allows the selected target ROI after estimated fees and selling costs.</p>
      <p><strong>Calculation:</strong> Net expected proceeds ÷ (1 + Target ROI).</p>
      <p><strong>Net expected proceeds:</strong> Expected selling price + buyer-paid shipping − estimated platform fees − selling costs.</p>
      <p><strong>Source:</strong> App-calculated from user-entered information and configured fee assumptions.</p>
    `
  },

  projectedProfit: {
    title: "Projected Profit",
    body: `
      <p><strong>What it means:</strong> The estimated dollars remaining after purchase cost, estimated fees, and selling costs.</p>
      <p><strong>Calculation:</strong> Expected revenue + buyer-paid shipping − estimated fees − selling costs − purchase price.</p>
      <p><strong>Important:</strong> This is an estimate until the actual sale price and actual fee are entered.</p>
      <p><strong>Source:</strong> App-calculated.</p>
    `
  },

  projectedRoi: {
    title: "Projected ROI",
    body: `
      <p><strong>What it means:</strong> The projected profit compared with the purchase investment.</p>
      <p><strong>Calculation:</strong> Projected Profit ÷ Purchase Price × 100.</p>
      <p><strong>Example:</strong> $125 projected profit on a $500 purchase equals 25% projected ROI.</p>
      <p><strong>Source:</strong> App-calculated.</p>
    `
  },

  estimatedFees: {
    title: "Estimated Platform Fees",
    body: `
      <p><strong>What it means:</strong> The app's estimate of what the selling marketplace may charge.</p>
      <p><strong>How it is calculated:</strong> Expected revenue multiplied by the configured platform fee percentage.</p>
      <p><strong>Important:</strong> Actual fees can vary due to category, seller plan, taxes, promoted listings, shipping, and marketplace policy changes.</p>
      <p><strong>Source:</strong> App fee assumption, not a live marketplace quote.</p>
    `
  },

  opportunityScore: {
    title: "Opportunity Score",
    body: `
      <p><strong>What it means:</strong> A 0–100 summary score intended to make potential deals easier to compare.</p>
      <p><strong>Current inputs:</strong> Projected ROI, projected dollar profit, and selected market confidence.</p>
      <p><strong>Important:</strong> This is an internal app score. It is not based on live market research, sell-through rate, or an AI model yet.</p>
      <p><strong>Source:</strong> App-calculated.</p>
    `
  },

  recommendation: {
    title: "BUY / NEGOTIATE / PASS",
    body: `
      <p><strong>BUY:</strong> The entered purchase price is comfortably below the maximum recommended buy and projected ROI meets the app's threshold.</p>
      <p><strong>NEGOTIATE:</strong> The deal is close, but the price should be reduced to protect the target return.</p>
      <p><strong>PASS:</strong> The current price is too high for the selected target ROI and entered assumptions.</p>
      <p><strong>Important:</strong> The recommendation is only as reliable as the expected selling price, fee assumption, condition assessment, and market confidence entered by the user.</p>
      <p><strong>Source:</strong> App-calculated decision rule.</p>
    `
  }
};

function openInfoModal(helpKey) {
  const content = helpContent[helpKey];
  if (!content) return;

  $("infoModalTitle").textContent = content.title;
  $("infoModalBody").innerHTML = content.body;
  $("infoModal").hidden = false;
  document.body.classList.add("modal-open");
}

function closeInfoModal() {
  $("infoModal").hidden = true;
  document.body.classList.remove("modal-open");
}

function populateDealAnalyzerFields() {
  const sourceBrand = $("brand");
  const dealBrand = $("dealBrand");

  if (sourceBrand && dealBrand) {
    dealBrand.innerHTML = sourceBrand.innerHTML;
  }

  const dealPlatform = $("dealExpectedPlatform");

  if (dealPlatform) {
    dealPlatform.innerHTML = platforms
      .map(
        platform =>
          `<option value="${platform}">${platform || "Select platform"}</option>`
      )
      .join("");
  }
}

function readDealForm() {
  const brandSelection = $("dealBrand")?.value || "";
  const customBrand = $("dealCustomBrand")?.value.trim() || "";

  return {
    brand: brandSelection === "Other" ? customBrand : brandSelection,
    itemName: $("dealItemName")?.value || "",
    size: $("dealSize")?.value || "",
    condition: $("dealCondition")?.value || "Excellent",
    marketConfidence: $("dealMarketConfidence")?.value || "Medium",
    purchasePrice: $("dealPurchasePrice")?.value || "",
    expectedSellingPrice: $("dealExpectedSellingPrice")?.value || "",
    expectedPlatform: $("dealExpectedPlatform")?.value || "",
    targetProfit: $("dealTargetProfit")?.value || "25",
    shippingCosts: $("dealShippingCosts")?.value || "0",
    buyerPaidShipping: $("dealBuyerPaidShipping")?.value || "0",
    listingPrice: "",
    salePrice: "",
    actualPlatformFee: "",
    actualSalePlatform: "",
    listingPlatforms: []
  };
}

function renderStandaloneDealAnalyzer() {
  const analysis = dealAnalysis(readDealForm());
  const card = $("dealAnalyzerCard");

  if (!card) return;

  card.classList.remove(
    "deal-buy",
    "deal-negotiate",
    "deal-pass",
    "deal-neutral"
  );

  card.classList.add(`deal-${analysis.state}`);

  $("dealRecommendation").textContent = analysis.recommendation;
  $("dealReason").textContent = analysis.reason;
  $("dealScore").textContent =
    analysis.score === null ? "—" : `${analysis.score}/100`;
  $("dealRevenue").textContent = money(analysis.revenue);
  $("dealFees").textContent = money(analysis.fee);
  $("dealCosts").textContent =
    money(number(readDealForm().shippingCosts));
  $("dealMaxBuy").textContent = money(analysis.maxBuy);
  $("dealProfit").textContent = money(analysis.profit);
  $("dealRoi").textContent = pct(analysis.roi);
}

function clearDealAnalyzer() {
  [
    "dealItemName",
    "dealSize",
    "dealPurchasePrice",
    "dealExpectedSellingPrice",
    "dealCustomBrand"
  ].forEach(id => {
    if ($(id)) $(id).value = "";
  });

  if ($("dealBrand")) $("dealBrand").value = "";
  if ($("dealCondition")) $("dealCondition").value = "Excellent";
  if ($("dealMarketConfidence")) $("dealMarketConfidence").value = "Medium";
  if ($("dealExpectedPlatform")) $("dealExpectedPlatform").value = "";
  if ($("dealTargetProfit")) $("dealTargetProfit").value = "25";
  if ($("dealShippingCosts")) $("dealShippingCosts").value = "0";
  if ($("dealBuyerPaidShipping")) $("dealBuyerPaidShipping").value = "0";
  if ($("dealCustomBrandWrap")) $("dealCustomBrandWrap").hidden = true;

  renderStandaloneDealAnalyzer();
}

function addDealToInventory() {
  const deal = readDealForm();
  setForm(null);

  const brandSelect = $("brand");
  const knownBrands = brandSelect
    ? Array.from(brandSelect.options).map(option => option.value)
    : [];

  if (deal.brand && !knownBrands.includes(deal.brand)) {
    if ($("brand")) $("brand").value = "Other";
    if ($("customBrand")) $("customBrand").value = deal.brand;
    if ($("customBrandWrap")) $("customBrandWrap").hidden = false;
  } else if ($("brand")) {
    $("brand").value = deal.brand || "";
  }

  const mapping = {
    itemName: deal.itemName,
    size: deal.size,
    condition: deal.condition,
    marketConfidence: deal.marketConfidence,
    purchasePrice: deal.purchasePrice,
    expectedSellingPrice: deal.expectedSellingPrice,
    expectedPlatform: deal.expectedPlatform,
    targetProfit: deal.targetProfit,
    shippingCosts: deal.shippingCosts,
    buyerPaidShipping: deal.buyerPaidShipping
  };

  Object.entries(mapping).forEach(([id, value]) => {
    if ($(id)) $(id).value = value ?? "";
  });

  $("formTitle").textContent = "Add Item";
  previewProfit();
  showTab("add");
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
  
document.querySelectorAll(".info-button").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openInfoModal(button.dataset.help);
  });
});

if ($("infoModalCloseBtn")) {
  $("infoModalCloseBtn").addEventListener("click", closeInfoModal);
}

if ($("infoModalDoneBtn")) {
  $("infoModalDoneBtn").addEventListener("click", closeInfoModal);
}

if ($("infoModal")) {
  $("infoModal").addEventListener("click", event => {
    if (event.target?.dataset?.closeInfo === "true") {
      closeInfoModal();
    }
  });
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("infoModal")?.hidden) {
    closeInfoModal();
  }
});

if ($("runInventoryImportBtn")) {
  $("runInventoryImportBtn").addEventListener("click", runInventoryImport);
}

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
    const haystack = `${i.inventoryNumber || ""} ${i.brand} ${i.itemName} ${i.size || ""} ${i.itemType || i.category || ""} ${i.color || ""} ${i.materialPattern || i.colorMaterial || ""} ${i.authentication || ""} ${(Array.isArray(i.listingPlatforms) ? i.listingPlatforms.join(" ") : (i.listingPlatform || ""))} ${i.purchaseSource} ${i.notes}`.toLowerCase();
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
        <span class="muted">${escapeHtml(
          [i.itemName, i.size].filter(Boolean).join(" · ")
        )}</span>
        <span class="muted">${escapeHtml(
          [i.itemType || i.category, i.color, i.materialPattern || i.colorMaterial]
            .filter(Boolean)
            .join(" · ")
        )}</span>
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
  renderStandaloneDealAnalyzer();
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
  const fields = ["inventoryNumber","favorite","brand","customBrand","itemName","size","itemType","customItemType","color","customColor","materialPattern","customMaterialPattern","status","condition","accessories","authentication",
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
    size: "",
    itemType: "Handbag",
    customItemType: "",
    color: "",
    customColor: "",
    materialPattern: "",
    customMaterialPattern: "",
    status: "Purchased",
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

  // Backward compatibility for older inventory records.
  if (isEditing) {
    if (!values.itemType && item.category) {
      values.itemType = item.category;
    }

    if ((!values.color || !values.materialPattern) && item.colorMaterial) {
      const legacy = String(item.colorMaterial).trim();

      const knownColors = [
        "Black", "Brown", "Beige", "Tan", "White", "Gray", "Red",
        "Burgundy", "Pink", "Purple", "Blue", "Navy", "Green",
        "Yellow", "Orange", "Gold", "Silver", "Multicolor"
      ];

      const matchingColor = knownColors.find(colorName =>
        legacy.toLowerCase().includes(colorName.toLowerCase())
      );

      if (!values.color && matchingColor) {
        values.color = matchingColor;
      }

      if (!values.materialPattern) {
        const remainder = matchingColor
          ? legacy.replace(new RegExp(matchingColor, "i"), "").trim()
          : legacy;

        values.materialPattern = remainder;
      }
    }
  }

  const brandSelect = $("brand");
  const knownBrands = brandSelect
    ? Array.from(brandSelect.options).map(option => option.value)
    : [];

  if (isEditing && values.brand && !knownBrands.includes(values.brand)) {
    values.customBrand = values.brand;
    values.brand = "Other";
  }

  const knownItemTypes = [
    "Handbag", "Tote", "Shoulder Bag", "Crossbody", "Satchel",
    "Hobo", "Bucket Bag", "Clutch", "Wallet", "Wristlet", "Pouch",
    "Backpack", "Duffel", "Briefcase", "Messenger", "Belt Bag",
    "Travel Bag", "Luggage", "Shoes", "Boots", "Sneakers",
    "Sandals", "Heels", "Scarf", "Belt", "Jewelry", "Watch",
    "Sunglasses", "Accessory", "Other"
  ];

  if (
    isEditing &&
    values.itemType &&
    !knownItemTypes.includes(values.itemType)
  ) {
    values.customItemType = values.itemType;
    values.itemType = "Other";
  }

  const knownColors = [
    "Black", "Brown", "Beige", "Tan", "White", "Gray", "Red",
    "Burgundy", "Pink", "Purple", "Blue", "Navy", "Green",
    "Yellow", "Orange", "Gold", "Silver", "Multicolor", "Other"
  ];

  if (
    isEditing &&
    values.color &&
    !knownColors.includes(values.color)
  ) {
    values.customColor = values.color;
    values.color = "Other";
  }

  const knownMaterials = [
    "Monogram Canvas", "Damier Ebene", "Damier Azur", "Empreinte",
    "Epi", "Vernis", "Monogram Vernis", "Taiga", "Mahina",
    "Saffiano", "Pebbled Leather", "Smooth Leather", "Calfskin",
    "Lambskin", "Caviar", "Patent Leather", "Canvas", "Nylon",
    "Denim", "Raffia", "Intrecciato", "House Check", "Nova Check",
    "GG Canvas", "GG Supreme", "Zucca", "Crocodile", "Python",
    "Suede", "Cotton", "Other"
  ];

  if (
    isEditing &&
    values.materialPattern &&
    !knownMaterials.includes(values.materialPattern)
  ) {
    values.customMaterialPattern = values.materialPattern;
    values.materialPattern = "Other";
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
    "itemType",
    "customItemTypeWrap",
    "customItemType"
  );

  toggleOtherField(
    "color",
    "customColorWrap",
    "customColor"
  );

  toggleOtherField(
    "materialPattern",
    "customMaterialPatternWrap",
    "customMaterialPattern"
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

    if (data.itemType === "Other") {
      data.itemType = data.customItemType.trim();
    }

    if (data.color === "Other") {
      data.color = data.customColor.trim();
    }

    if (data.materialPattern === "Other") {
      data.materialPattern = data.customMaterialPattern.trim();
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

    if (!data.itemType.trim()) {
      throw new Error("Please select or enter the item type.");
    }

    if ($("color")?.value === "Other" && !data.color.trim()) {
      throw new Error("Please enter the Other color.");
    }

    if (
      $("materialPattern")?.value === "Other" &&
      !data.materialPattern.trim()
    ) {
      throw new Error("Please enter the Other material or pattern.");
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
    delete data.customItemType;
    delete data.customColor;
    delete data.customMaterialPattern;
    delete data.customExpectedPlatform;
    delete data.customActualSalePlatform;
    delete data.category;
    delete data.colorMaterial;
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


function renderImportPreview() {
  const body = $("importPreviewRows");
  if (!body) return;

  body.innerHTML = inventoryImportRecords.map(record => `
    <tr>
      <td><strong>${escapeHtml(record.brand)}</strong></td>
      <td>${escapeHtml([record.itemName, record.size].filter(Boolean).join(" · ") || "—")}</td>
      <td>${escapeHtml(record.itemType || "—")}</td>
      <td>${escapeHtml([record.color, record.materialPattern].filter(Boolean).join(" · ") || "—")}</td>
      <td>${money(record.purchasePrice)}</td>
      <td>${record.listingPrice ? money(record.listingPrice) : "Not listed"}</td>
      <td>${escapeHtml(record.status)}</td>
    </tr>
  `).join("");
}

async function runInventoryImport() {
  if (!isTeamAdmin(currentMember)) {
    $("importProgress").className = "message error";
    $("importProgress").textContent = "Only an Owner or Admin can run the inventory import.";
    return;
  }

  if (!confirm("Import the 28 prepared inventory records? Existing records will not be overwritten.")) {
    return;
  }

  const button = $("runInventoryImportBtn");
  button.disabled = true;
  button.textContent = "Importing…";

  try {
    const existingKeys = new Set(items.map(item => item.importKey).filter(Boolean));
    const toImport = inventoryImportRecords.filter(record => !existingKeys.has(record.importKey));

    if (!toImport.length) {
      $("importProgress").className = "message ok";
      $("importProgress").textContent = "All 28 records were already imported. No duplicates were created.";
      return;
    }

    let nextSequence = items.reduce((highest, item) => {
      const match = String(item.inventoryNumber || "").match(/AE-(\d+)/i);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;

    let imported = 0;

    for (const record of toImport) {
      const data = {
        ...record,
        inventoryNumber: `AE-${String(nextSequence).padStart(4, "0")}`,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || "",
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ""
      };

      delete data.sourceRow;
      await addDoc(itemCollection(), data);
      nextSequence += 1;
      imported += 1;

      $("importProgress").className = "message";
      $("importProgress").textContent = `Imported ${imported} of ${toImport.length} items…`;
    }

    $("importProgress").className = "message ok";
    $("importProgress").textContent =
      `Import complete: ${imported} items added. ${inventoryImportRecords.length - imported} existing import records were skipped.`;
  } catch (error) {
    console.error(error);
    $("importProgress").className = "message error";
    $("importProgress").textContent = friendlyError(error);
  } finally {
    button.disabled = false;
    button.textContent = "Import 28 Items";
  }
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

    if ($("importTabButton")) {
      $("importTabButton").hidden = !isTeamAdmin(currentMember);
    }

    renderImportPreview();
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

[
  "dealBrand",
  "dealCustomBrand",
  "dealItemName",
  "dealSize",
  "dealCondition",
  "dealMarketConfidence",
  "dealPurchasePrice",
  "dealExpectedSellingPrice",
  "dealExpectedPlatform",
  "dealTargetProfit",
  "dealShippingCosts",
  "dealBuyerPaidShipping"
].forEach(id => {
  const element = $(id);
  if (!element) return;

  const eventName =
    element.tagName === "SELECT" ? "change" : "input";

  element.addEventListener(eventName, () => {
    if (id === "dealBrand" && $("dealCustomBrandWrap")) {
      const isOther =
        $("dealBrand").value === "Other";

      $("dealCustomBrandWrap").hidden = !isOther;

      if (!isOther && $("dealCustomBrand")) {
        $("dealCustomBrand").value = "";
      }
    }

    renderStandaloneDealAnalyzer();
  });
});

if ($("clearDealBtn")) {
  $("clearDealBtn").onclick = clearDealAnalyzer;
}

if ($("addDealToInventoryBtn")) {
  $("addDealToInventoryBtn").onclick = addDealToInventory;
}

document.querySelectorAll(".tab").forEach(b => b.onclick = () => showTab(b.dataset.tab));
["purchasePrice","expectedSellingPrice","listingPrice","salePrice","actualPlatformFee","shippingCosts","buyerPaidShipping","expectedPlatform","actualSalePlatform"]
  .forEach(id => $(id).addEventListener("input", previewProfit));

window.addEventListener("online", () => $("syncBadge").textContent = "Reconnecting…");
window.addEventListener("offline", () => $("syncBadge").textContent = "Offline");

populatePlatforms();
populateDealAnalyzerFields();
previewProfit();
renderStandaloneDealAnalyzer();
