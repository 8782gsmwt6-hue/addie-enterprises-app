import { firebaseConfig, WORKSPACE_ID } from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";


/* =========================================================
   FIREBASE SETUP
========================================================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {
  // Offline persistence may already be enabled in another tab.
});


/* =========================================================
   PLATFORM SETTINGS
========================================================= */

const platforms = [
  "",
  "eBay",
  "Poshmark",
  "Facebook Marketplace",
  "Mercari",
  "The RealReal",
  "Vestiaire Collective",
  "Consignment Store",
  "Direct / Private Sale",
  "Other"
];

const estimatedFeeRates = {
  "eBay": 0.15,
  "Poshmark": 0.20,
  "Facebook Marketplace": 0,
  "Mercari": 0.10,
  "The RealReal": 0.40,
  "Vestiaire Collective": 0.15,
  "Consignment Store": 0.40,
  "Direct / Private Sale": 0,
  "Other": 0.15,
  "": 0
};


/* =========================================================
   APP STATE AND HELPERS
========================================================= */

let items = [];
let unsubscribeItems = null;

const $ = id => document.getElementById(id);

const number = value => Number(value || 0);

const money = value =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(number(value));

const pct = value => `${(number(value) * 100).toFixed(1)}%`;

const escapeHtml = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]
  );

/*
  IMPORTANT:
  Your Firebase collection is named "Workspaces"
  with a capital W.
*/
const itemCollection = () =>
  collection(db, "Workspaces", WORKSPACE_ID, "items");


/* =========================================================
   PLATFORM MENUS
========================================================= */

function populatePlatforms() {
  ["expectedPlatform", "listingPlatform"].forEach(id => {
    const element = $(id);

    if (!element) return;

    element.innerHTML = platforms
      .map(
        platform =>
          `<option value="${platform}">
            ${platform || "Select platform"}
          </option>`
      )
      .join("");
  });
}


/* =========================================================
   PROFIT CALCULATION
========================================================= */

function calculation(item) {
  const purchasePrice = number(item.purchasePrice);
  const listingPrice = number(item.listingPrice);
  const expectedSellingPrice = number(item.expectedSellingPrice);
  const salePrice = number(item.salePrice);

  const shippingCosts = number(item.shippingCosts);
  const buyerPaidShipping = number(item.buyerPaidShipping);
  const actualPlatformFee = number(item.actualPlatformFee);

  const saleEntered = salePrice > 0;
  const listingEntered = listingPrice > 0;

  /*
    Calculation priority:

    1. Actual Sale Price
    2. Listing Price
    3. Expected Selling Price
  */
  let revenue = 0;
  let type = "Projected";
  let basis = "No price entered";

  if (saleEntered) {
    revenue = salePrice;
    type = "Actual";
    basis = "Sale price";
  } else if (listingEntered) {
    revenue = listingPrice;
    type = "Projected";
    basis = "Listing price";
  } else {
    revenue = expectedSellingPrice;
    type = "Projected";
    basis = "Expected price";
  }

  const platform =
    item.listingPlatform ||
    item.expectedPlatform ||
    "";

  /*
    Before sale:
    Estimate the platform fee.

    After sale:
    Use the actual platform fee entered by the user.
  */
  const fee = saleEntered
    ? actualPlatformFee
    : revenue * number(estimatedFeeRates[platform]);

  const netProceeds =
    revenue +
    buyerPaidShipping -
    fee -
    shippingCosts;

  const profit = netProceeds - purchasePrice;

  const roi =
    purchasePrice > 0
      ? profit / purchasePrice
      : 0;

  return {
    purchase: purchasePrice,
    revenue,
    fee,
    shippingCosts,
    buyerPaidShipping,
    netProceeds,
    profit,
    roi,
    type,
    basis,
    saleEntered
  };
}


/* =========================================================
   NAVIGATION
========================================================= */

function showTab(id) {
  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.tab === id
    );
  });

  document.querySelectorAll(".panel").forEach(panel => {
    panel.classList.toggle(
      "active",
      panel.id === id
    );
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


/* =========================================================
   DASHBOARD METRICS
========================================================= */

function renderMetrics() {
  /*
    An item is considered sold only when an actual Sale Price
    has been entered.
  */
  const soldItems = items.filter(
    item => number(item.salePrice) > 0
  );

  const unsoldItems = items.filter(
    item => number(item.salePrice) <= 0
  );

  const totalInvested = items.reduce(
    (total, item) =>
      total + number(item.purchasePrice),
    0
  );

  const inventoryCost = unsoldItems.reduce(
    (total, item) =>
      total + number(item.purchasePrice),
    0
  );

  const projectedProfit = unsoldItems.reduce(
    (total, item) =>
      total + calculation(item).profit,
    0
  );

  const actualProfit = soldItems.reduce(
    (total, item) =>
      total + calculation(item).profit,
    0
  );

  const combinedProfit =
    projectedProfit + actualProfit;

  const combinedRoi =
    totalInvested > 0
      ? combinedProfit / totalInvested
      : 0;

  const data = [
    [
      "Items",
      items.length,
      "All tracked inventory"
    ],
    [
      "Sold",
      soldItems.length,
      "Actual sale price entered"
    ],
    [
      "Inventory Cost",
      money(inventoryCost),
      "Purchase cost of unsold items"
    ],
    [
      "Projected Profit",
      money(projectedProfit),
      "Based on listing prices"
    ],
    [
      "Actual Profit",
      money(actualProfit),
      "Based on completed sales"
    ],
    [
      "Combined Profit",
      money(combinedProfit),
      "Projected plus actual"
    ],
    [
      "Combined ROI",
      pct(combinedRoi),
      "Based on total purchase cost"
    ]
  ];

  $("metrics").innerHTML = data
    .map(
      ([label, value, subtext]) => `
        <div class="metric">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
          <div class="sub">${subtext}</div>
        </div>
      `
    )
    .join("");
}


/* =========================================================
   DASHBOARD TABLE
========================================================= */

function renderDashboardRows() {
  if (!items.length) {
    $("dashboardRows").innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          No items yet.
        </td>
      </tr>
    `;

    return;
  }

  $("dashboardRows").innerHTML = items
    .map(item => {
      const result = calculation(item);

      const statusClass =
        item.status === "Sold"
          ? "sold"
          : item.status === "Listed"
            ? "listed"
            : "";

      const profitClass =
        result.profit >= 0
          ? "profit-positive"
          : "profit-negative";

      return `
        <tr>
          <td>
            <strong>
              ${escapeHtml(item.brand)}
              ${escapeHtml(item.itemName)}
            </strong>
          </td>

          <td>
            <span class="pill ${statusClass}">
              ${escapeHtml(item.status || "In Inventory")}
            </span>
          </td>

          <td>${result.type}</td>

          <td>
            ${result.basis}: ${money(result.revenue)}
          </td>

          <td class="${profitClass}">
            ${money(result.profit)}
          </td>

          <td>${pct(result.roi)}</td>
        </tr>
      `;
    })
    .join("");
}


/* =========================================================
   INVENTORY TABLE
========================================================= */

function renderItems() {
  const term =
    $("searchInput").value
      .trim()
      .toLowerCase();

  const selectedStatus =
    $("statusFilter").value;

  const filteredItems = items.filter(item => {
    const searchText = `
      ${item.brand || ""}
      ${item.itemName || ""}
      ${item.purchaseSource || ""}
      ${item.notes || ""}
    `.toLowerCase();

    const matchesSearch =
      !term || searchText.includes(term);

    const matchesStatus =
      !selectedStatus ||
      item.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  $("emptyItems").hidden =
    filteredItems.length > 0;

  $("itemRows").innerHTML = filteredItems
    .map(item => {
      const result = calculation(item);

      const updated =
        item.updatedAt?.toDate
          ? item.updatedAt
              .toDate()
              .toLocaleString()
          : "Syncing…";

      const statusClass =
        item.status === "Sold"
          ? "sold"
          : item.status === "Listed"
            ? "listed"
            : "";

      const profitClass =
        result.profit >= 0
          ? "profit-positive"
          : "profit-negative";

      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.brand)}</strong>
            <span class="muted">
              ${escapeHtml(item.itemName)}
            </span>
          </td>

          <td>
            ${money(item.purchasePrice)}
            <span class="muted">
              ${escapeHtml(item.purchaseDate || "")}
            </span>
          </td>

          <td>
            ${
              number(item.listingPrice) > 0
                ? money(item.listingPrice)
                : "—"
            }
            <span class="muted">
              ${escapeHtml(item.listingPlatform || "")}
            </span>
          </td>

          <td>
            ${
              number(item.salePrice) > 0
                ? money(item.salePrice)
                : "—"
            }
            <span class="muted">
              ${escapeHtml(item.saleDate || "")}
            </span>
          </td>

          <td class="${profitClass}">
            ${money(result.profit)}
            <span class="muted">
              ${result.type}
            </span>
          </td>

          <td>${pct(result.roi)}</td>

          <td>
            <span class="pill ${statusClass}">
              ${escapeHtml(item.status || "In Inventory")}
            </span>
          </td>

          <td class="muted">
            ${updated}
          </td>

          <td>
            <div class="row-actions">
              <button
                class="secondary edit-btn"
                data-id="${item.id}"
              >
                Edit
              </button>

              <button
                class="danger delete-btn"
                data-id="${item.id}"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  document
    .querySelectorAll(".edit-btn")
    .forEach(button => {
      button.onclick = () =>
        editItem(button.dataset.id);
    });

  document
    .querySelectorAll(".delete-btn")
    .forEach(button => {
      button.onclick = () =>
        removeItem(button.dataset.id);
    });
}


/* =========================================================
   RENDER EVERYTHING
========================================================= */

function renderAll() {
  renderMetrics();
  renderDashboardRows();
  renderItems();
}


/* =========================================================
   LIVE PROFIT PREVIEW
========================================================= */

function previewProfit() {
  const draft = readForm();
  const result = calculation(draft);

  $("profitPreview").classList.toggle(
    "actual",
    result.saleEntered
  );

  const profitClass =
    result.profit >= 0
      ? "profit-positive"
      : "profit-negative";

  $("profitPreview").innerHTML = `
    <div class="preview-cell">
      <div class="k">Calculation</div>
      <div class="v">${result.type} Profit</div>
    </div>

    <div class="preview-cell">
      <div class="k">Revenue Basis</div>
      <div class="v">
        ${result.basis}: ${money(result.revenue)}
      </div>
    </div>

    <div class="preview-cell">
      <div class="k">
        ${result.saleEntered ? "Actual" : "Estimated"} Fees
      </div>
      <div class="v">${money(result.fee)}</div>
    </div>

    <div class="preview-cell">
      <div class="k">Profit</div>
      <div class="v ${profitClass}">
        ${money(result.profit)}
      </div>
    </div>

    <div class="preview-cell">
      <div class="k">ROI</div>
      <div class="v">${pct(result.roi)}</div>
    </div>
  `;
}


/* =========================================================
   READ FORM
========================================================= */

function readForm() {
  const fields = [
    "brand",
    "itemName",
    "category",
    "status",
    "colorMaterial",
    "condition",
    "accessories",
    "authentication",
    "purchaseDate",
    "purchaseSource",
    "purchasePrice",
    "targetProfit",
    "expectedPlatform",
    "expectedSellingPrice",
    "recommendedMaxBuy",
    "marketConfidence",
    "listingDate",
    "listingPlatform",
    "listingPrice",
    "salePrice",
    "saleDate",
    "actualPlatformFee",
    "shippingCosts",
    "buyerPaidShipping",
    "notes",
    "pricingAnalysis"
  ];

  return Object.fromEntries(
    fields.map(id => [
      id,
      $(id)?.value ?? ""
    ])
  );
}


/* =========================================================
   POPULATE FORM
========================================================= */

function setForm(item = {}) {
  const defaults = {
    category: "Handbag",
    status: "In Inventory",
    condition: "Excellent",
    authentication: "Not authenticated",
    targetProfit: "25",
    marketConfidence: "Medium",
    shippingCosts: "0",
    buyerPaidShipping: "0"
  };

  const values = {
    ...defaults,
    ...item
  };

  Object.keys(values).forEach(key => {
    if ($(key)) {
      $(key).value = values[key] ?? "";
    }
  });

  $("editId").value = item.id || "";

  $("formTitle").textContent =
    item.id
      ? "Edit Item"
      : "Add Item";

  $("deleteCurrentBtn").hidden =
    !item.id;

  $("formMessage").textContent = "";

  previewProfit();
}


/* =========================================================
   SAVE ITEM
========================================================= */

async function saveItem(event) {
  event.preventDefault();

  const data = readForm();

  if (!data.brand.trim()) {
    $("formMessage").className =
      "message error";

    $("formMessage").textContent =
      "Please enter a brand.";

    return;
  }

  if (!data.itemName.trim()) {
    $("formMessage").className =
      "message error";

    $("formMessage").textContent =
      "Please enter an item or model name.";

    return;
  }

  if (
    data.purchasePrice === "" ||
    number(data.purchasePrice) < 0
  ) {
    $("formMessage").className =
      "message error";

    $("formMessage").textContent =
      "Please enter a valid purchase price.";

    return;
  }

  /*
    Entering a Sale Price automatically changes
    the status to Sold.
  */
  if (number(data.salePrice) > 0) {
    data.status = "Sold";
  }

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

  data.updatedAt = serverTimestamp();

  data.updatedBy =
    auth.currentUser?.email || "Unknown user";

  $("formMessage").className = "message";
  $("formMessage").textContent = "Saving…";

  try {
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
      data.createdAt = serverTimestamp();

      data.createdBy =
        auth.currentUser?.email || "Unknown user";

      await addDoc(
        itemCollection(),
        data
      );
    }

    $("formMessage").className =
      "message ok";

    $("formMessage").textContent =
      "Saved and synced.";

    setForm();
    showTab("items");
  } catch (error) {
    console.error(error);

    $("formMessage").className =
      "message error";

    $("formMessage").textContent =
      `Save failed: ${error.message}`;
  }
}


/* =========================================================
   EDIT ITEM
========================================================= */

function editItem(id) {
  const item = items.find(
    currentItem => currentItem.id === id
  );

  if (!item) return;

  setForm(item);
  showTab("add");
}


/* =========================================================
   DELETE ITEM
========================================================= */

async function removeItem(id) {
  const item = items.find(
    currentItem => currentItem.id === id
  );

  if (!item) return;

  const confirmed = confirm(
    `Delete ${item.brand} ${item.itemName}? ` +
    "This removes it from every connected device."
  );

  if (!confirmed) return;

  try {
    await deleteDoc(
      doc(
        db,
        "Workspaces",
        WORKSPACE_ID,
        "items",
        id
      )
    );

    if ($("editId").value === id) {
      setForm();
    }
  } catch (error) {
    console.error(error);

    alert(
      `Delete failed: ${error.message}`
    );
  }
}


/* =========================================================
   REAL-TIME FIREBASE SYNC
========================================================= */

function startItemSync() {
  if (unsubscribeItems) {
    unsubscribeItems();
  }

  $("syncBadge").textContent = "Syncing…";

  const itemQuery = query(
    itemCollection(),
    orderBy("updatedAt", "desc")
  );

  unsubscribeItems = onSnapshot(
    itemQuery,
    snapshot => {
      items = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      $("syncBadge").textContent =
        navigator.onLine
          ? "Cloud synced"
          : "Offline";

      renderAll();
    },
    error => {
      console.error(error);

      $("syncBadge").textContent =
        "Sync error";
    }
  );
}


/* =========================================================
   AUTHENTICATION STATE
========================================================= */

onAuthStateChanged(auth, user => {
  $("authScreen").hidden = Boolean(user);
  $("appShell").hidden = !user;

  if (user) {
    $("currentUser").textContent =
      `Signed in as ${user.email}`;

    startItemSync();
    setForm();
  } else {
    if (unsubscribeItems) {
      unsubscribeItems();
      unsubscribeItems = null;
    }

    items = [];
  }
});


/* =========================================================
   SIGN IN
========================================================= */

$("authForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    $("authMessage").className = "message";
    $("authMessage").textContent =
      "Signing in…";

    try {
      await signInWithEmailAndPassword(
        auth,
        $("authEmail").value.trim(),
        $("authPassword").value
      );

      $("authMessage").textContent = "";
    } catch (error) {
      console.error(error);

      $("authMessage").className =
        "message error";

      $("authMessage").textContent =
        error.message;
    }
  }
);


/* =========================================================
   CREATE ACCOUNT
========================================================= */

if ($("createAccountBtn")) {
  $("createAccountBtn").onclick = async () => {
    $("authMessage").className = "message";
    $("authMessage").textContent =
      "Creating account…";

    try {
      await createUserWithEmailAndPassword(
        auth,
        $("authEmail").value.trim(),
        $("authPassword").value
      );
    } catch (error) {
      console.error(error);

      $("authMessage").className =
        "message error";

      $("authMessage").textContent =
        error.message;
    }
  };
}


/* =========================================================
   BUTTONS AND EVENT LISTENERS
========================================================= */

$("signOutBtn").onclick = () =>
  signOut(auth);

if ($("settingsSignOutBtn")) {
  $("settingsSignOutBtn").onclick = () =>
    signOut(auth);
}

$("itemForm").addEventListener(
  "submit",
  saveItem
);

$("cancelEditBtn").onclick = () => {
  setForm();
  showTab("items");
};

$("newItemBtn").onclick = () => {
  setForm();
  showTab("add");
};

$("deleteCurrentBtn").onclick = () =>
  removeItem($("editId").value);

$("searchInput").addEventListener(
  "input",
  renderItems
);

$("statusFilter").addEventListener(
  "change",
  renderItems
);

document
  .querySelectorAll(".tab")
  .forEach(button => {
    button.onclick = () =>
      showTab(button.dataset.tab);
  });

[
  "purchasePrice",
  "expectedSellingPrice",
  "listingPrice",
  "salePrice",
  "actualPlatformFee",
  "shippingCosts",
  "buyerPaidShipping",
  "expectedPlatform",
  "listingPlatform"
].forEach(id => {
  if ($(id)) {
    $(id).addEventListener(
      "input",
      previewProfit
    );

    $(id).addEventListener(
      "change",
      previewProfit
    );
  }
});


/* =========================================================
   ONLINE / OFFLINE STATUS
========================================================= */

window.addEventListener("online", () => {
  $("syncBadge").textContent =
    "Reconnecting…";
});

window.addEventListener("offline", () => {
  $("syncBadge").textContent =
    "Offline";
});


/* =========================================================
   STARTUP
========================================================= */

populatePlatforms();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js")
    .catch(error => {
      console.error(
        "Service worker error:",
        error
      );
    });
}
