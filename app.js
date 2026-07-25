const $=id=>document.getElementById(id), num=v=>Number(String(v||"").replace(/[^0-9.-]/g,""))||0;
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n)||0);
const brands=["Louis Vuitton","Chanel","Gucci","Hermès","Prada","Bottega Veneta","Burberry","Saint Laurent","Fendi","Dior","Celine","Loewe","Balenciaga","Givenchy","Valentino","Ferragamo","Coach","Tory Burch","MCM","Goyard","Cartier","Versace","Mulberry","Chloé","Other / Enter manually"];
$("brand").innerHTML=brands.map(x=>`<option>${x}</option>`).join("");
$("brand").onchange=()=>$("customWrap").classList.toggle("hidden",$("brand").value!=="Other / Enter manually");
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab,.panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});
const field=id=>$(id).value.trim()||"Not provided";
function makePrompt(){
const margin=num($("margin").value)||25, brand=$("brand").value==="Other / Enter manually"?field("customBrand"):$("brand").value;
const p=`Act as a cautious luxury resale pricing analyst and experienced luxury consignment buyer. Use current web research.

PRIMARY OBJECTIVE
Determine the maximum purchase price that should be paid today to have a realistic chance of earning at least a ${margin}% profit on the all-in purchase cost after marketplace fees, payment costs, seller-paid shipping, and other selling costs.

Do not merely estimate resale value. Give a clear recommended purchase-price ceiling and a BUY / NEGOTIATE / PASS decision.

ITEM
- Brand: ${brand}
- Model/item: ${field("model")}
- Style/category: ${field("style")}
- Color: ${field("color")}
- Material: ${field("material")}
- Size: ${field("size")}
- Condition: ${field("condition")}
- Condition details/flaws: ${field("details")}
- Accessories included: ${field("accessories")}
- Authentication status: ${field("authentication")}
- Purchase platform/source: ${field("source")}
- Current asking price or bid: ${$("knownPrice").value?money(num($("knownPrice").value)):"Not provided"}
- Likely selling platform: ${field("platform")}
- Seller-paid shipping estimate: ${money(num($("shipping").value))}
- Target profit margin on all-in purchase cost: ${margin}%

RESEARCH RULES
1. Prioritize recent completed/sold listings over active asking prices.
2. Find the closest matches by model, size, material, color, condition, accessories, and authentication status.
3. Cite each usable comparable with platform, date, sold price, condition, and source link when available.
4. Never invent sold listings, prices, dates, fees, links, or sell-through data.
5. Clearly separate sold evidence from active asking prices.
6. Exclude or down-weight obvious outliers and materially different items.
7. If exact sold evidence is thin, say so and lower the confidence rating.
8. Use the selling platform's current fee structure and explain all assumptions.
9. Distinguish profit margin from ROI.

CALCULATIONS
For low, realistic, and optimistic sale scenarios, calculate:
- Expected accepted sale price
- Platform/payment fees
- Shipping and other selling costs
- Net sale proceeds
- Maximum all-in purchase price that preserves a ${margin}% profit

Use:
Maximum purchase price = net sale proceeds ÷ (1 + target profit margin)

Also show:
Dollar profit = net sale proceeds − all-in purchase price
ROI = dollar profit ÷ all-in purchase price × 100

REQUIRED OUTPUT
A. A concise table of the best recent sold comparables, with active listings shown separately.
B. Low, realistic, and optimistic resale outcomes; recommended listing price; expected accepted offer; lowest reasonable offer; likely time to sale; demand; liquidity; and pricing confidence.
C. A scenario table showing sale price, fees, shipping, net proceeds, maximum purchase price, dollar profit, and ROI.
D. Decision:
🟢 BUY — realistic case comfortably meets the target at the current price.
🟡 NEGOTIATE — works only below a specific price or relies too much on the optimistic case.
🔴 PASS — current price is too high, evidence is too weak, or realistic economics miss the target.
E. End with:
- Recommended maximum purchase price: $___
- Stretch maximum purchase price: $___
- Current-price decision: BUY / NEGOTIATE / PASS / NOT PROVIDED
- “If I were buying this item today, I would pay no more than $___.”

Be cautious. Base the recommended maximum on the realistic case, not the optimistic case.`;
$("prompt").value=p;return p}
$("build").onclick=makePrompt;
async function copyPrompt(){const p=makePrompt();try{await navigator.clipboard.writeText(p)}catch{$("prompt").select();document.execCommand("copy")}return p}
$("copy").onclick=async()=>{$("status").textContent="Prompt copied.";await copyPrompt()};
$("open").onclick=async()=>{await copyPrompt();$("status").textContent="Prompt copied. Opening ChatGPT — paste it into a new chat.";setTimeout(()=>location.href="https://chatgpt.com/",250)};
function ceiling(){const sale=num($("expectedSale").value),fee=num($("fee").value)/100,ship=num($("shipping").value),m=num($("margin").value)/100;if(!sale){$("result").textContent="Enter an expected sale price.";return}const net=sale-sale*fee-ship,max=net/(1+m),profit=net-max;$("result").innerHTML=`Net proceeds: <b>${money(net)}</b><br>Preliminary maximum purchase price: <b>${money(max)}</b><br>Profit at that price: <b>${money(profit)}</b><br><small>Confirm with sold-market research.</small>`}
["expectedSale","fee","shipping","margin"].forEach(id=>$(id).oninput=ceiling);
let db=JSON.parse(localStorage.getItem("addie_v2")||'{"items":[],"expenses":[]}');function save(){localStorage.setItem("addie_v2",JSON.stringify(db));render()}
$("saveItem").onclick=()=>{db.items.unshift({id:crypto.randomUUID(),name:field("itemName"),brand:field("itemBrand"),purchaseDate:$("purchaseDate").value,purchase:num($("purchasePrice").value),saleDate:$("saleDate").value,sale:num($("sellingPrice").value),platform:$("salePlatform").value,notes:$("notes").value.trim()});save()};
$("saveExpense").onclick=()=>{const amount=num($("expenseAmount").value);if(!amount)return alert("Enter an amount.");db.expenses.unshift({id:crypto.randomUUID(),date:$("expenseDate").value,category:$("expenseCategory").value,amount,description:$("expenseDescription").value.trim()});save()};
window.delItem=id=>{db.items=db.items.filter(x=>x.id!==id);save()};window.delExpense=id=>{db.expenses=db.expenses.filter(x=>x.id!==id);save()};
function render(){
$("itemList").innerHTML=db.items.length?db.items.map(x=>`<div class="item"><div class="head"><span>${x.brand} — ${x.name}</span><button class="delete" onclick="delItem('${x.id}')">Delete</button></div><div class="meta">Bought ${x.purchaseDate||"—"} for ${money(x.purchase)}${x.sale?` · Sold for ${money(x.sale)} on ${x.platform}<br>Gross profit: ${money(x.sale-x.purchase)} · ROI: ${x.purchase?((x.sale-x.purchase)/x.purchase*100).toFixed(1):"0.0"}%`:" · Unsold"}${x.notes?`<br>${x.notes}`:""}</div></div>`).join(""):'<p class="helper">No items saved.</p>';
$("expenseList").innerHTML=db.expenses.length?db.expenses.map(x=>`<div class="item"><div class="head"><span>${x.category}</span><button class="delete" onclick="delExpense('${x.id}')">Delete</button></div><div class="meta">${x.date||"—"} · ${money(x.amount)}${x.description?` · ${x.description}`:""}</div></div>`).join(""):'<p class="helper">No expenses saved.</p>';
const invested=db.items.reduce((a,x)=>a+x.purchase,0),sales=db.items.reduce((a,x)=>a+x.sale,0),profit=sales-invested,expenses=db.expenses.reduce((a,x)=>a+x.amount,0);
$("sItems").textContent=db.items.length;$("sInvested").textContent=money(invested);$("sSales").textContent=money(sales);$("sProfit").textContent=money(profit);$("sExpenses").textContent=money(expenses);$("sNet").textContent=money(profit-expenses)}
$("export").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));a.download="addie-enterprises-backup.json";a.click()};
const today=new Date().toISOString().slice(0,10);$("purchaseDate").value=today;$("expenseDate").value=today;makePrompt();render();
