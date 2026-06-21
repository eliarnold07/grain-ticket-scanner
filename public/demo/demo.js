const state={
  saleType:'Spot',
  bins:[
    {id:'b1',name:'North 48',crop:'Corn',capacity:45000,current:38620,notes:'Aeration running'},
    {id:'b2',name:'West Bin',crop:'Corn',capacity:32000,current:21740,notes:'Harvest 2025 carryover'},
    {id:'b3',name:'Soy 12',crop:'Soybeans',capacity:24000,current:16480,notes:'Quality checked Jun 18'}
  ],
  contracts:[
    {id:'c1',number:'C-26041',buyer:'Riverbend Grain Co.',crop:'Corn',total:25000,delivered:18440,price:4.82,window:'June–July 2026'},
    {id:'c2',number:'S-11807',buyer:'Heartland Processing',crop:'Soybeans',total:15000,delivered:9275,price:11.34,window:'July 2026'},
    {id:'c3',number:'C-26088',buyer:'Midwest Ethanol',crop:'Corn',total:30000,delivered:6200,price:4.95,window:'August 2026'}
  ],
  tickets:[
    {id:1,number:'RB-10481',date:'06/20/2026',crop:'Corn',from:'North 48',to:'Riverbend Grain Co.',bushels:2844.64,assignment:'Contract',payment:'Not paid',hauler:'Jordan Lee',contract:'c1'},
    {id:2,number:'HP-77124',date:'06/19/2026',crop:'Soybeans',from:'Soy 12',to:'Heartland Processing',bushels:918.33,assignment:'Contract',payment:'Paid',hauler:'Sam Rivera',contract:'c2'},
    {id:3,number:'ME-44602',date:'06/18/2026',crop:'Corn',from:'West Bin',to:'Midwest Ethanol',bushels:2756.91,assignment:'Spot',payment:'Paid',hauler:'Morgan Tate'},
    {id:4,number:'RB-10463',date:'06/17/2026',crop:'Corn',from:'North 48',to:'Riverbend Grain Co.',bushels:2798.12,assignment:'Contract',payment:'Not paid',hauler:'Jordan Lee',contract:'c1'},
    {id:5,number:'HP-77092',date:'06/16/2026',crop:'Soybeans',from:'Soy 12',to:'Heartland Processing',bushels:894.55,assignment:'Spot',payment:'Paid',hauler:'Sam Rivera'}
  ],
  users:[
    {name:'Alex Morgan',email:'alex@prairieridge.demo',role:'admin'},
    {name:'Jordan Lee',email:'jordan@prairieridge.demo',role:'employee'},
    {name:'Sam Rivera',email:'sam@prairieridge.demo',role:'employee'}
  ]
};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const money=n=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});
function go(view){$$('.view,.view-tabs button').forEach(x=>x.classList.remove('active'));$('#'+view).classList.add('active');$(`.view-tabs button[data-view="${view}"]`).classList.add('active');location.hash=view;scrollTo({top:0,behavior:'smooth'})}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)}
function renderDashboard(){
  const corn=state.bins.filter(b=>b.crop==='Corn').reduce((s,b)=>s+b.current,0),soy=state.bins.filter(b=>b.crop==='Soybeans').reduce((s,b)=>s+b.current,0),stored=corn+soy,capacity=state.bins.reduce((s,b)=>s+b.capacity,0);
  const kpis=[['Corn Inventory',`${fmt(corn)} bu`,'across 2 bins'],['Soybean Inventory',`${fmt(soy)} bu`,'across 1 bin'],['Total Stored',`${fmt(stored)} bu`,'live estimated balance'],['Tickets Scanned',state.tickets.length+143,'this farm'],['Bushels Sold','94,381.70 bu','recorded deliveries'],['Active Bins',state.bins.length,'managed storage']];
  $('#kpiGrid').innerHTML=kpis.map(x=>`<article><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></article>`).join('');
  const unpaid=state.tickets.filter(t=>t.payment!=='Paid'),unassigned=state.tickets.filter(t=>!t.assignment).length;
  $('#financeGrid').innerHTML=[['Unpaid Delivered',`${fmt(unpaid.reduce((s,t)=>s+t.bushels,0))} bu`],['Unpaid Estimated',money(unpaid.reduce((s,t)=>s+t.bushels*4.82,0))],['Open Contract Balances',state.contracts.length],['Unassigned Tickets',unassigned]].map(x=>`<article><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join('');
  const max=Math.max(corn,soy);$('#cropChart').innerHTML=[['Corn',corn],['Soybeans',soy]].map(x=>`<div class="crop-row"><strong>${x[0]}</strong><div class="bar"><i style="width:${x[1]/max*100}%"></i></div><span>${fmt(x[1])} bu</span></div>`).join('');
  $('#utilization').innerHTML=`<strong>${Math.round(stored/capacity*100)}%</strong><span>${fmt(stored)} of ${fmt(capacity)} bu</span><div class="capacity"><i style="width:${stored/capacity*100}%"></i></div>`;
  renderBins('#dashboardBins');
}
function binCard(b){const p=Math.round(b.current/b.capacity*100);return `<article class="bin-card"><header><div><h3>${b.name}</h3><p>${b.crop}</p></div><span class="tag ${p>85?'gold':''}">${p}% full</span></header><strong>${fmt(b.current)} bu</strong><div class="capacity"><i style="width:${p}%"></i></div><div class="bin-meta"><span>${fmt(b.capacity)} bu capacity</span><span>${b.notes}</span></div></article>`}
function renderBins(target){$(target).innerHTML=state.bins.map(binCard).join('')}
function renderContracts(){ $('#contractGrid').innerHTML=state.contracts.map(c=>{const p=Math.min(100,c.delivered/c.total*100);return `<article class="contract-card"><header><div><p>${c.crop} · Open</p><h3>${c.number}</h3><p>${c.buyer}</p></div><strong>${money(c.price)}/bu</strong></header><div class="progress"><div class="capacity"><i style="width:${p}%"></i></div></div><div class="contract-metrics"><div><span>Contracted</span><strong>${fmt(c.total)} bu</strong></div><div><span>Delivered</span><strong>${fmt(c.delivered)} bu</strong></div><div><span>Remaining</span><strong>${fmt(Math.max(0,c.total-c.delivered))} bu</strong></div></div><p style="margin-top:14px">${c.window}</p></article>`}).join('')}
function renderTickets(){
  const q=$('#historySearch').value.toLowerCase(),a=$('#assignmentFilter').value,p=$('#paymentFilter').value;
  const rows=state.tickets.filter(t=>(!q||Object.values(t).join(' ').toLowerCase().includes(q))&&(!a||t.assignment===a)&&(!p||t.payment===p));
  $('#ticketRows').innerHTML=rows.map(t=>`<tr><td><strong>${t.number}</strong></td><td>${t.date}</td><td>${t.crop}</td><td>${t.from}</td><td>${t.to}</td><td>${fmt(t.bushels)}</td><td><span class="tag ${t.assignment==='Spot'?'gold':''}">${t.assignment}</span></td><td><button class="payment-button tag ${t.payment==='Paid'?'':'red'}" data-pay="${t.id}">${t.payment}</button></td><td><button class="secondary" data-edit="${t.id}">View</button></td></tr>`).join('');
}
function renderUsers(){ $('#userList').innerHTML=state.users.map((u,i)=>`<div class="user-row"><div><strong>${u.name}</strong><span>${u.email}</span></div><div class="user-actions"><span class="tag">${u.role}</span>${u.role==='employee'?`<button data-promote="${i}">Promote</button>`:''}</div></div>`).join('')}
function populateSelects(){const bins=state.bins.map(b=>`<option>${b.name}</option>`).join('');$('#sourceBin').innerHTML=bins;$('#scannerContract').innerHTML='<option value="">Choose outstanding contract</option>'+state.contracts.map(c=>`<option value="${c.id}">${c.number} · ${c.buyer} · ${fmt(Math.max(0,c.total-c.delivered))} bu remaining</option>`).join('')}
function extract(){const f=$('#ticketForm');f.ticket_number.value='RB-10482';f.date.value='06/21/2026';f.crop.value='Corn';f.hauled_from.value='North 48';f.delivered_to.value='Riverbend Grain Co.';f.bushels.value='2811.43';f.hauled_by.value='Jordan Lee';f.moisture.value='15.2';$('#scanStatus').textContent='Extraction complete. Review highlighted fields before submitting.';toast('Ticket data extracted with AI confidence checks')}
$$('.view-tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
$('#extractButton').onclick=extract;
$$('[data-sale]').forEach(b=>b.onclick=()=>{$$('[data-sale]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.saleType=b.dataset.sale;$('#contractPicker').hidden=state.saleType!=='Contract'});
$('#ticketForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;if(!f.ticket_number.value)return toast('Extract the sample ticket first');const amount=Number(f.bushels.value),bin=state.bins.find(b=>b.name===f.hauled_from.value);bin.current=Math.max(0,bin.current-amount);const contractId=state.saleType==='Contract'?f.contract_id.value:'';if(state.saleType==='Contract'&&!contractId)return toast('Choose a contract before submitting');const contract=state.contracts.find(c=>c.id===contractId);if(contract)contract.delivered+=amount;state.tickets.unshift({id:Date.now(),number:f.ticket_number.value,date:f.date.value,crop:f.crop.value,from:f.hauled_from.value,to:f.delivered_to.value,bushels:amount,assignment:state.saleType,payment:'Not paid',hauler:f.hauled_by.value,contract:contractId});renderAll();toast('Ticket submitted. Inventory and contract balances updated.');go('dashboard')};
['historySearch','assignmentFilter','paymentFilter'].forEach(id=>$('#'+id).oninput=renderTickets);
$('#ticketRows').onclick=e=>{const pay=e.target.dataset.pay;if(pay){const t=state.tickets.find(x=>x.id==pay);t.payment=t.payment==='Paid'?'Not paid':'Paid';renderTickets();renderDashboard();toast(`Ticket ${t.number} marked ${t.payment.toLowerCase()}`)}if(e.target.dataset.edit)toast('Ticket review opened — edits are simulated in this portfolio demo.')};
$('#adjustButton').onclick=()=>{state.bins[1].current+=500;renderAll();toast('Added 500 bu to West Bin. Dashboard recalculated.')};
$('#newContractButton').onclick=()=>{state.contracts.push({id:'c'+Date.now(),number:'C-26104',buyer:'Great Plains Milling',crop:'Corn',total:20000,delivered:0,price:5.03,window:'September 2026'});renderContracts();populateSelects();toast('Demo contract C-26104 created.')};
$('#userForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget;state.users.push({name:f.name.value,email:f.email.value,role:f.role.value});f.reset();renderUsers();toast('Demo user added to Prairie Ridge Farms.')};
$('#userList').onclick=e=>{if(e.target.dataset.promote!==undefined){state.users[Number(e.target.dataset.promote)].role='admin';renderUsers();toast('Employee promoted to administrator.')}};
$('#exportButton').onclick=()=>toast('CSV export prepared — disabled from downloading in the public demo.');
function renderAll(){renderDashboard();renderBins('#inventoryBins');renderContracts();renderTickets();renderUsers();populateSelects()}
const tour=[['A complete operating picture','The dashboard combines inventory, ticket volume, contract exposure, and payment follow-up in one farm-level view.','dashboard'],['AI-assisted ticket capture','BinFlow turns a grain ticket photo into structured data, then requires a human review before anything is saved.','scanner'],['Reconciliation without spreadsheets','Ticket history keeps assignments and payment status connected to the original load.','history'],['Inventory that moves with the work','Submitting or editing tickets updates bin balances and contract progress, keeping records aligned.','inventory'],['Built for real farm teams','Admins manage operations while scanner-only employees can quickly submit loads from the field.','users']];
let tourStep=0;function showTour(){const t=tour[tourStep];go(t[2]);$('#tourTitle').textContent=t[0];$('#tourCopy').textContent=t[1];$('#tourProgress').innerHTML=tour.map((_,i)=>`<i class="${i<=tourStep?'active':''}"></i>`).join('');$('#tourNext').textContent=tourStep===tour.length-1?'Finish':'Next';$('#modal').hidden=false}
$('#tourButton').onclick=()=>{tourStep=0;showTour()};$('#tourNext').onclick=()=>{if(tourStep===tour.length-1){$('#modal').hidden=true;go('dashboard')}else{tourStep++;showTour()}};$('#tourSkip').onclick=$('.modal-close').onclick=()=>$('#modal').hidden=true;
renderAll();go(location.hash.slice(1)&&$('#'+location.hash.slice(1))?location.hash.slice(1):'dashboard');
