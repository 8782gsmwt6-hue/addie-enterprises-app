
const STORAGE_KEY = "addieEnterprisesDataV1";
let state = loadState();

function blankState(){ return {dark:false, items:[]}; }
function loadState(){
  try { return Object.assign(blankState(), JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")); }
  catch(e){ return blankState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function money(n){ return Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"}); }
function num(id){ return Number(document.getElementById(id).value||0); }
function val(id){ return document.getElementById(id).value; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

function calc(item){
  const invested = Number(item.purchasePrice||0)+Number(item.authCost||0)+Number(item.repairCost||0)+Number(item.inboundShipping||0)+Number(item.otherCosts||0);
  const net = Number(item.salePrice||0)-Number(item.platformFees||0)-Number(item.outboundShipping||0);
  const profit = item.status==="sold" ? net-invested : 0;
  const margin = item.status==="sold" && Number(item.salePrice||0)>0 ? profit/Number(item.salePrice||0)*100 : 0;
  const roi = invested>0 ? profit/invested*100 : 0;
  return {invested,net,profit,margin,roi};
}

function daysHeld(item){
  if(!item.purchaseDate) return 0;
  const end = item.status==="sold" && item.saleDate ? new Date(item.saleDate) : new Date();
  const start = new Date(item.purchaseDate);
  return Math.max(0, Math.round((end-start)/86400000));
}

function collectForm(){
  return {
    id: val("itemId") || uid(),
    brand: val("brand").trim(),
    model: val("model").trim(),
    category: val("category"),
    condition: val("condition"),
    purchaseDate: val("purchaseDate"),
    purchasePrice: num("purchasePrice"),
    purchaseSource: val("purchaseSource").trim(),
    authCost: num("authCost"),
    repairCost: num("repairCost"),
    inboundShipping: num("inboundShipping"),
    otherCosts: num("otherCosts"),
    listingPrice: num("listingPrice"),
    status: val("status"),
    platform: val("platform").trim(),
    saleDate: val("saleDate"),
    salePrice: num("salePrice"),
    platformFees: num("platformFees"),
    outboundShipping: num("outboundShipping"),
    notes: val("notes").trim(),
    updatedAt: new Date().toISOString()
  };
}

function updateCalcPreview(){
  const item = collectForm();
  const c = calc(item);
  document.getElementById("calcInvested").textContent = money(c.invested);
  document.getElementById("calcNet").textContent = money(c.net);
  document.getElementById("calcProfit").textContent = money(c.profit);
  document.getElementById("calcMargin").textContent = `${c.margin.toFixed(1)}%`;
}

function resetForm(){
  document.getElementById("itemForm").reset();
  document.getElementById("itemId").value="";
  document.getElementById("formTitle").textContent="Add an item";
  document.getElementById("cancelEditBtn").classList.add("hidden");
  updateCalcPreview();
}

function saveItem(e){
  e.preventDefault();
  const item = collectForm();
  const idx = state.items.findIndex(x=>x.id===item.id);
  if(idx>=0) state.items[idx]=item; else state.items.unshift(item);
  saveState();
  resetForm();
  renderAll();
  showScreen("inventoryScreen","Inventory");
  alert("Item saved.");
}

function editItem(id){
  const item = state.items.find(x=>x.id===id); if(!item) return;
  Object.entries(item).forEach(([k,v])=>{
    const el=document.getElementById(k);
    if(el) el.value=v ?? "";
  });
  document.getElementById("formTitle").textContent="Edit item";
  document.getElementById("cancelEditBtn").classList.remove("hidden");
  updateCalcPreview();
  showScreen("addScreen","Edit item");
}

function deleteItem(id){
  if(!confirm("Delete this item permanently?")) return;
  state.items = state.items.filter(x=>x.id!==id);
  saveState(); renderAll();
}

function itemCard(item){
  const c=calc(item);
  const d=document.createElement("article"); d.className="item-card card";
  const statusClass=item.status==="sold"?"sold":"";
  d.innerHTML=`
    <div>
      <div><span class="badge ${statusClass}">${item.status==="sold"?"Sold":"In inventory"}</span></div>
      <h3>${escapeHtml(item.brand)} ${escapeHtml(item.model)}</h3>
      <div class="item-meta">
        ${escapeHtml(item.category)} • ${escapeHtml(item.condition)}<br>
        Invested: ${money(c.invested)}${item.listingPrice?` • Listed: ${money(item.listingPrice)}`:""}<br>
        ${item.status==="sold" ? `Sale: ${money(item.salePrice)} • Profit: <span class="money ${c.profit>=0?"positive":"negative"}">${money(c.profit)}</span> • Margin: ${c.margin.toFixed(1)}%` : `Held: ${daysHeld(item)} days`}
        ${item.platform?`<br>Platform: ${escapeHtml(item.platform)}`:""}
      </div>
    </div>
    <div class="item-actions">
      <button class="small-btn edit">Edit</button>
      <button class="small-btn delete">Delete</button>
    </div>`;
  d.querySelector(".edit").onclick=()=>editItem(item.id);
  d.querySelector(".delete").onclick=()=>deleteItem(item.id);
  return d;
}

function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function renderInventory(){
  const q=val("searchInput").toLowerCase().trim();
  const status=val("statusFilter");
  const list=document.getElementById("inventoryList"); list.innerHTML="";
  const items=state.items.filter(i=>{
    const text=[i.brand,i.model,i.category,i.condition,i.platform,i.purchaseSource].join(" ").toLowerCase();
    return (!q||text.includes(q)) && (status==="all"||i.status===status);
  });
  if(!items.length){ list.innerHTML='<div class="card empty">No matching items yet.</div>'; return; }
  items.forEach(i=>list.appendChild(itemCard(i)));
}

function renderDashboard(){
  const active=state.items.filter(i=>i.status==="inventory");
  const sold=state.items.filter(i=>i.status==="sold");
  const totalInvested=state.items.reduce((s,i)=>s+calc(i).invested,0);
  const totalRevenue=sold.reduce((s,i)=>s+Number(i.salePrice||0),0);
  const totalProfit=sold.reduce((s,i)=>s+calc(i).profit,0);
  const avgProfit=sold.length?totalProfit/sold.length:0;
  const avgMargin=sold.length?sold.reduce((s,i)=>s+calc(i).margin,0)/sold.length:0;
  const avgDays=sold.length?sold.reduce((s,i)=>s+daysHeld(i),0)/sold.length:0;

  document.getElementById("statActive").textContent=active.length;
  document.getElementById("statInvested").textContent=money(totalInvested);
  document.getElementById("statRevenue").textContent=money(totalRevenue);
  document.getElementById("statProfit").textContent=money(totalProfit);
  document.getElementById("snapSold").textContent=sold.length;
  document.getElementById("snapAvgProfit").textContent=money(avgProfit);
  document.getElementById("snapMargin").textContent=`${avgMargin.toFixed(1)}%`;
  document.getElementById("snapDays").textContent=Math.round(avgDays);

  const recent=document.getElementById("recentItems"); recent.innerHTML="";
  const recentItems=[...state.items].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,5);
  if(!recentItems.length){ recent.innerHTML='<div class="empty">Add the first item to start tracking the business.</div>'; }
  recentItems.forEach(i=>{
    const c=calc(i), row=document.createElement("div"); row.className="recent-row";
    row.innerHTML=`<div><strong>${escapeHtml(i.brand)} ${escapeHtml(i.model)}</strong><div class="muted">${i.status==="sold"?"Sold":"In inventory"}</div></div><strong>${i.status==="sold"?money(c.profit):money(c.invested)}</strong>`;
    recent.appendChild(row);
  });
  drawProfitChart(sold);
}

function drawProfitChart(sold){
  const c=document.getElementById("profitChart"),ctx=c.getContext("2d"),ratio=devicePixelRatio||1,w=c.clientWidth||320,h=190;
  c.width=w*ratio;c.height=h*ratio;ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const rows=[...sold].filter(i=>i.saleDate).sort((a,b)=>a.saleDate.localeCompare(b.saleDate));
  if(!rows.length){ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--muted");ctx.font="14px -apple-system";ctx.fillText("Sold items will create a profit trend here.",14,28);return;}
  let running=0; const pts=rows.map(i=>(running+=calc(i).profit));
  const min=Math.min(0,...pts),max=Math.max(0,...pts),pad=30;
  ctx.strokeStyle="#e6dce5";ctx.beginPath();ctx.moveTo(pad,10);ctx.lineTo(pad,h-pad);ctx.lineTo(w-8,h-pad);ctx.stroke();
  ctx.strokeStyle="#7b3f72";ctx.lineWidth=3;ctx.beginPath();
  pts.forEach((v,i)=>{const x=pad+(w-pad-12)*(i/Math.max(1,pts.length-1));const y=10+(h-pad-14)*(1-(v-min)/(max-min||1));i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
}

function exportBackup(){
  downloadFile(`addie-enterprises-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),"application/json");
}
function importBackup(file){
  const r=new FileReader();
  r.onload=()=>{try{state=Object.assign(blankState(),JSON.parse(r.result));saveState();location.reload();}catch(e){alert("That backup file could not be read.");}};
  r.readAsText(file);
}
function exportCsv(){
  const headers=["Brand","Model","Category","Condition","Purchase Date","Purchase Price","Purchase Source","Authentication","Repair/Cleaning","Inbound Shipping","Other Costs","Total Invested","Listing Price","Status","Platform","Sale Date","Sale Price","Platform Fees","Outbound Shipping","Net Proceeds","Profit","Margin %","ROI %","Days Held","Notes"];
  const rows=state.items.map(i=>{const c=calc(i);return [i.brand,i.model,i.category,i.condition,i.purchaseDate,i.purchasePrice,i.purchaseSource,i.authCost,i.repairCost,i.inboundShipping,i.otherCosts,c.invested,i.listingPrice,i.status,i.platform,i.saleDate,i.salePrice,i.platformFees,i.outboundShipping,c.net,c.profit,c.margin.toFixed(2),c.roi.toFixed(2),daysHeld(i),i.notes];});
  const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadFile(`addie-enterprises-${new Date().toISOString().slice(0,10)}.csv`,csv,"text/csv");
}
function downloadFile(name,text,type){
  const blob=new Blob([text],{type}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
function showScreen(id,title){
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
  document.getElementById("screenTitle").textContent=title;
  if(id==="inventoryScreen")renderInventory();
  if(id==="dashboardScreen")renderDashboard();
  window.scrollTo(0,0);
}
function renderAll(){renderDashboard();renderInventory();}

function init(){
  document.body.classList.toggle("dark",state.dark);
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>showScreen(b.dataset.screen,b.textContent.trim().replace(/[⌂▦＋⚙]/g,"")));
  document.getElementById("themeBtn").onclick=()=>{state.dark=!state.dark;saveState();document.body.classList.toggle("dark",state.dark);renderDashboard();};
  document.getElementById("itemForm").addEventListener("submit",saveItem);
  document.getElementById("cancelEditBtn").onclick=()=>{resetForm();showScreen("inventoryScreen","Inventory");};
  document.getElementById("searchInput").oninput=renderInventory;
  document.getElementById("statusFilter").onchange=renderInventory;
  document.querySelectorAll("#itemForm input,#itemForm select").forEach(el=>el.addEventListener("input",updateCalcPreview));
  document.getElementById("exportBackupBtn").onclick=exportBackup;
  document.getElementById("importBackupInput").onchange=e=>e.target.files[0]&&importBackup(e.target.files[0]);
  document.getElementById("exportCsvBtn").onclick=exportCsv;
  document.getElementById("resetBtn").onclick=()=>{if(confirm("Erase all Addie Enterprises data?")){localStorage.removeItem(STORAGE_KEY);location.reload();}};
  resetForm();renderAll();
  if("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(()=>{});
}
init();
