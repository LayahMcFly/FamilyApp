/*
  The Family Recipe Book, Family Circle edition
  Copyright (C) 2026 Leia

  Adapted from The Family Recipe Book in the ZenfulOutput project (also by Leia).
  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  The license text is in LICENSE-GPL-3.0.txt in this folder.
  Changes from the original: its own online account, sync, AI method writer and
  outside recipe feed are removed; recipes are kept per Family Circle member on this device.
*/
(()=>{
'use strict';

/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Family Circle edition: every key is stored under the signed-in Family Circle member's id,
   so two people sharing one device never see each other's recipes. Nothing is stored until
   Family Circle has confirmed who is signed in (see Gate below). */
let NS='';
const store={
  get(k){try{return NS?localStorage.getItem(NS+k):null}catch{return null}},
  set(k,v){try{if(!NS)return false;localStorage.setItem(NS+k,v);return true}catch{return false}},
  del(k){try{if(NS)localStorage.removeItem(NS+k)}catch{}}
};
const Gate={
  start(go){
    if(window.parent===window){$('#app').innerHTML='<p class="note">This recipe book opens from inside Family Circle. Go to the Family Circle Hub and choose Recipes.</p>';return}
    let done=false;
    addEventListener('message',e=>{
      if(done||e.source!==window.parent||e.origin!==location.origin)return;
      const d=e.data;
      if(!d||d.type!=='fc-recipes-init'||typeof d.userId!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(d.userId))return;
      done=true;NS='fcrb:'+d.userId+':';window.__RB_IDB='fcrb_cookbooks_'+d.userId;go();
    });
    window.parent.postMessage({type:'fc-recipes-ready'},location.origin);
    setTimeout(()=>{if(!done)$('#app').innerHTML='<p class="note">I could not confirm your Family Circle sign-in. Go back to the Hub and open Recipes again.</p>'},8000);
  }
};
const uuid=()=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
const slugify=s=>String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_-]+/g,'-')||'recipe';
const app=$('#app');
const S={type:'',mode:null,base:'',token:'',user:null,favs:new Set(),cats:[],org:{categories:null,tags:null},query:'',cat:'',onlyFavs:false,page:1,totalPages:1,demo:[],deleted:{},cur:null,checked:new Set(),f:1,base:0,target:0,label:''};
const API=()=>Book;
const isFav=r=>!!r.fav;

function toast(msg){
  const t=$('#toast');t.textContent=msg;t.classList.add('on');
  clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),4200);
}
function errMsg(e){
  if(!e)return 'Something went wrong.';
  if(e.message==='NETWORK')return "I couldn't reach that address. Check the spelling and that the server is running. If both look right, the server may be set to block pages like this one. It also needs to start with https:// when this page is on https.";
  return e.message||'Something went wrong.';
}

/* ---------- decoration: border, cursor ---------- */
function frameSVG(){
  const L='#f7efdf',C='#b0845b',R='#93573a',P='#ead6b0',LF='#a8996b';
  const flower=(x,y)=>`<g transform="translate(${x} ${y})"><g fill="${P}" stroke="${R}" stroke-width=".9"><circle cx="6" cy="0" r="3.7"/><circle cx="1.85" cy="5.7" r="3.7"/><circle cx="-4.85" cy="3.53" r="3.7"/><circle cx="-4.85" cy="-3.53" r="3.7"/><circle cx="1.85" cy="-5.7" r="3.7"/></g><circle r="2.7" fill="${C}"/></g>`;
  const leaf=(x,y,a)=>`<ellipse cx="${x}" cy="${y}" rx="5" ry="2.1" transform="rotate(${a} ${x} ${y})" fill="${LF}" opacity=".85"/>`;
  const arc=`fill="none" stroke="${C}" stroke-width="1.4"`;
  const dash=`stroke="${C}" stroke-width="1.3" stroke-dasharray="3 3" stroke-linecap="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90">
<g fill="${L}"><rect width="30" height="30"/><rect x="60" width="30" height="30"/><rect y="60" width="30" height="30"/><rect x="60" y="60" width="30" height="30"/>
<path d="M30 0V16A15 13.2 0 0 0 60 16V0Z"/><path d="M30 90V74A15 13.2 0 0 1 60 74V90Z"/><path d="M0 30H16A13.2 15 0 0 1 16 60H0Z"/><path d="M90 30H74A13.2 15 0 0 0 74 60H90Z"/></g>
<path d="M30 16A15 13.2 0 0 0 60 16" ${arc}/><path d="M30 74A15 13.2 0 0 1 60 74" ${arc}/><path d="M16 30A13.2 15 0 0 1 16 60" ${arc}/><path d="M74 30A13.2 15 0 0 0 74 60" ${arc}/>
<line x1="30" y1="5" x2="60" y2="5" ${dash}/><line x1="30" y1="85" x2="60" y2="85" ${dash}/><line x1="5" y1="30" x2="5" y2="60" ${dash}/><line x1="85" y1="30" x2="85" y2="60" ${dash}/>
<g fill="${R}"><circle cx="45" cy="15" r="2.2"/><circle cx="45" cy="75" r="2.2"/><circle cx="15" cy="45" r="2.2"/><circle cx="75" cy="45" r="2.2"/></g>
${leaf(23,23,45)}${leaf(67,23,-45)}${leaf(23,67,-45)}${leaf(67,67,45)}
${flower(14,14)}${flower(76,14)}${flower(14,76)}${flower(76,76)}
</svg>`;
}
function spoon(heart){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M13 13L27.5 27.5" stroke="#40291d" stroke-width="5" stroke-linecap="round"/><path d="M13 13L27.5 27.5" stroke="#d9b98a" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="8.5" cy="8.5" rx="7" ry="4.6" transform="rotate(45 8.5 8.5)" fill="#d9b98a" stroke="#40291d" stroke-width="1.6"/>${heart?'<path d="M24 12.5C20.5 10 20.5 7.6 22.4 7.2c.8-.2 1.3.3 1.6.9.3-.6.8-1.1 1.6-.9 1.9.4 1.9 2.8-1.6 5.3z" fill="#93573a"/>':''}</svg>`;
}
function decorate(){
  const uri=svg=>`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  $('#frame').style.borderImageSource=uri(frameSVG());
  const root=document.documentElement.style;
  root.setProperty('--cur',`${uri(spoon(false))} 4 4, auto`);
  root.setProperty('--cur-hover',`${uri(spoon(true))} 4 4, pointer`);
}

/* ---------- small templates ---------- */
const HEART='<svg class="hrt" viewBox="0 0 24 24" aria-label="hearted"><path d="M12 21C5 15.5 3 12 3 8.8 3 6.2 5 4.5 7.3 4.5c1.9 0 3.5 1 4.7 2.8 1.2-1.8 2.8-2.8 4.7-2.8C19 4.5 21 6.2 21 8.8c0 3.2-2 6.7-9 12.2z"/></svg>';
const divider=()=>`<svg class="divider" viewBox="0 0 400 20" aria-hidden="true"><line x1="0" y1="10" x2="172" y2="10" stroke="#b0845b" stroke-width="1.5" stroke-dasharray="5 5"/><path transform="translate(191.6 1.6) scale(.7)" fill="#93573a" d="M12 21C5 15.5 3 12 3 8.8 3 6.2 5 4.5 7.3 4.5c1.9 0 3.5 1 4.7 2.8 1.2-1.8 2.8-2.8 4.7-2.8C19 4.5 21 6.2 21 8.8c0 3.2-2 6.7-9 12.2z"/><line x1="228" y1="10" x2="400" y2="10" stroke="#b0845b" stroke-width="1.5" stroke-dasharray="5 5"/></svg>`;
const placeholder=()=>`<div class="ph" data-ph><svg viewBox="0 0 120 90" aria-hidden="true"><g fill="none" stroke="#8a6447" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M26 46h68c0 17-12 28-34 28S26 63 26 46z"/><path d="M20 46h80"/><path d="M48 36c-4-5 4-8 0-14M62 36c-4-5 4-8 0-14M76 36c-4-5 4-8 0-14"/></g></svg></div>`;
const imgTag=(url,alt)=>url?`<img src="${esc(url)}" alt="${esc(alt)}">`:placeholder();
document.addEventListener('error',e=>{
  const t=e.target;
  if(t&&t.tagName==='IMG'&&t.closest('.photo')){const d=document.createElement('div');d.innerHTML=placeholder();t.replaceWith(d.firstChild)}
},true);

/* ---------- images ---------- */
function shrink(file,max){
  return new Promise((res,rej)=>{
    const img=new Image(),u=URL.createObjectURL(file);
    img.onload=()=>{
      const k=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);
      c.toBlob(b=>b?res(b):rej(new Error('image')),'image/jpeg',.86);
    };
    img.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('image'))};
    img.src=u;
  });
}
const toDataURL=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b)});

/* ---------- The book (kept in this browser) ---------- */
const seed=()=>[
  {name:"Grandma's Banana Bread",description:"The loaf that always sat on the counter under a dish towel. It slices best the next day.",yield:'1 loaf',prep:'10 minutes',cook:'1 hour',total:'1 hour 10 minutes',
   ingredients:['3 very ripe bananas, mashed','1/3 cup melted butter','3/4 cup sugar','1 egg, beaten','1 teaspoon vanilla','1 teaspoon baking soda','1 pinch of salt','1 1/2 cups all-purpose flour'],
   steps:['Heat the oven to 350°F (175°C) and butter a 4x8 inch loaf pan.','Mash the bananas in a large bowl, then stir in the melted butter.','Mix in the sugar, egg and vanilla.','Sprinkle the baking soda and salt over the batter and stir. Add the flour and mix until just combined.','Pour into the pan and bake for 55 to 60 minutes, until a toothpick comes out clean.','Cool in the pan for 10 minutes, then turn out onto a rack.'],
   categories:['Baking'],tags:['Family favorite'],notes:'Use the spottiest bananas you can find. Wrap the cooled loaf in foil overnight and it cuts without crumbling.'},
  {name:'Sunday Chicken and Rice Soup',description:'A big pot for a cold afternoon. It tastes even better the second day.',yield:'6 bowls',prep:'15 minutes',cook:'40 minutes',total:'55 minutes',
   ingredients:['1 tablespoon olive oil','1 onion, diced','2 carrots, sliced','2 celery stalks, sliced','3 garlic cloves, minced','8 cups chicken broth','1 pound boneless chicken thighs','3/4 cup long-grain rice','2 bay leaves','1 teaspoon salt, plus more to taste','Black pepper','Juice of half a lemon','Chopped parsley'],
   steps:['Warm the oil in a large pot over medium heat. Cook the onion, carrots and celery for 6 minutes.','Stir in the garlic and cook for 1 minute.','Add the broth, chicken and bay leaves. Bring to a boil, then lower the heat and simmer for 15 minutes.','Stir in the rice and simmer for 15 minutes more, until the rice is tender and the chicken reaches 165°F.','Lift the chicken out, shred it with two forks and return it to the pot. Remove the bay leaves.','Finish with the lemon juice, salt, pepper and parsley.'],
   categories:['Soups'],tags:['Comfort food'],notes:'The rice keeps soaking up broth as it sits. Add a splash of water when you reheat it.'},
  {name:'Buttermilk Pancakes',description:'Thick, tender pancakes for slow weekend mornings.',yield:'12 pancakes',prep:'10 minutes',cook:'15 minutes',total:'25 minutes',
   ingredients:['2 cups all-purpose flour','2 tablespoons sugar','2 teaspoons baking powder','1 teaspoon baking soda','1/2 teaspoon salt','2 cups buttermilk','2 eggs','4 tablespoons melted butter, plus more for the pan','1 teaspoon vanilla'],
   steps:['Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.','In another bowl, whisk the buttermilk, eggs, melted butter and vanilla.','Pour the wet mixture into the dry and stir until just combined. A few lumps are fine.','Let the batter rest for 5 minutes while the griddle heats over medium.','Butter the griddle and pour 1/4 cup of batter for each pancake.','Flip when bubbles form and the edges look set, about 2 to 3 minutes. Cook 1 to 2 minutes on the second side.'],
   categories:['Breakfast'],tags:[],notes:''},
  {name:'Apple Crumble',description:'Warm apples under a buttery oat topping.',yield:'8 servings',prep:'20 minutes',cook:'45 minutes',total:'1 hour 5 minutes',
   ingredients:['6 apples, peeled and sliced (about 2 pounds)','1/4 cup sugar','1 tablespoon lemon juice','1 teaspoon cinnamon','1 cup all-purpose flour','3/4 cup rolled oats','1/2 cup brown sugar','1/2 teaspoon cinnamon','1/2 cup cold butter, cubed','1 pinch of salt'],
   steps:['Heat the oven to 350°F (175°C).','Toss the apples with the sugar, lemon juice and cinnamon, then spread them in a 9 inch baking dish.','Mix the flour, oats, brown sugar, cinnamon and salt. Rub in the butter with your fingers until the mixture clumps.','Scatter the topping over the apples.','Bake for 40 to 45 minutes, until golden on top and bubbling at the edges.','Let it cool for 15 minutes and serve warm with vanilla ice cream.'],
   categories:['Dessert'],tags:['Fall'],notes:'A mix of tart and sweet apples gives the best flavor.'}
].map((r,i)=>({...r,slug:slugify(r.name),id:'book-'+i,image:'',source:'',fav:i===0}));
const Book={
  persist(skipSync){
    const ok=store.set('rb_recipes',JSON.stringify(S.demo))&store.set('rb_deleted',JSON.stringify(S.deleted));
    if(!ok)toast('This browser would not save that change. It will be gone when you close the page.');
  },
  boot(){
    let d=null,from='';
    for(const k of['rb_recipes','rb_demo']){
      try{const x=JSON.parse(store.get(k));if(Array.isArray(x)){d=x;from=k;break}}catch{}
    }
    S.demo=d||seed();
    try{const x=JSON.parse(store.get('rb_deleted'));if(x&&typeof x==='object')S.deleted=x}catch{}
    if(from!=='rb_recipes')Book.persist(true);
  },
  async list({page,query,cat,favs,type}){
    let a=S.demo.slice();
    if(type==='meal')a=a.filter(isMeal);else if(type==='dish')a=a.filter(r=>!isMeal(r));
    if(query){const q=query.toLowerCase();a=a.filter(r=>(r.name+' '+r.ingredients.join(' ')+' '+r.categories.join(' ')+' '+r.tags.join(' ')).toLowerCase().includes(q))}
    if(cat)a=a.filter(r=>r.categories.some(c=>slugify(c)===cat));
    if(favs)a=a.filter(r=>r.fav);
    return{items:a.slice((page-1)*24,page*24),totalPages:Math.max(1,Math.ceil(a.length/24))};
  },
  async get(slug){const r=S.demo.find(x=>x.slug===slug);if(!r)throw new Error('I could not find that recipe.');return r},
  async categories(){const m=new Map();S.demo.forEach(r=>r.categories.forEach(c=>m.set(slugify(c),c)));return[...m].map(([slug,name])=>({slug,name}))},
  async save(v,slug,file){
    let r=slug&&S.demo.find(x=>x.slug===slug);
    if(!r){
      let base=slugify(v.name),s=base,n=2;
      while(S.demo.some(x=>x.slug===s))s=base+'-'+n++;
      r={slug:s,id:'book-'+uuid(),image:'',fav:false};S.demo.unshift(r);
    }
    Object.assign(r,{name:v.name,description:v.description,yield:v.yield,prep:v.prep,cook:v.cook,total:v.total,source:v.source,notes:v.notes,ingredients:v.ingredients,steps:v.steps,parts:v.parts||[],categories:v.categories,tags:v.tags,updated:Date.now()});
    if(file){try{r.image=await toDataURL(await shrink(file,800))}catch{toast('I could not read that photo.')}}
    Book.persist();return r.slug;
  },
  async remove(r){S.demo=S.demo.filter(x=>x.slug!==r.slug);S.deleted[r.slug]=Date.now();Book.persist()},
  async fav(r,on){const x=S.demo.find(y=>y.slug===r.slug);if(x){x.fav=on;x.updated=Date.now();Book.persist()}}
};

const cleanRecipe=(r,stamp)=>{
  const arr=x=>Array.isArray(x)?x.map(String):[];
  return{slug:String(r.slug||slugify(r.name)),id:String(r.id||'book-'+uuid()),name:String(r.name),description:String(r.description||''),yield:String(r.yield||''),prep:String(r.prep||''),cook:String(r.cook||''),total:String(r.total||''),
    ingredients:arr(r.ingredients),steps:arr(r.steps),parts:arr(r.parts),categories:arr(r.categories),tags:arr(r.tags),notes:String(r.notes||''),source:String(r.source||''),
    image:/^data:image\//.test(r.image||'')?r.image:'',fav:!!r.fav,updated:Number(r.updated)||stamp};
};

const VERSION='v2.0.6';

/* ---------- Scaling servings ---------- */
const FRAC={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
const NUMSRC=String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+[½⅓⅔¼¾⅛⅜⅝⅞]?|[½⅓⅔¼¾⅛⅜⅝⅞])`;
function parseQty(t){
  t=t.trim();let m;
  if((m=t.match(/^(\d+)\s+(\d+)\/(\d+)$/)))return +m[1]+m[2]/m[3];
  if((m=t.match(/^(\d+)\/(\d+)$/)))return m[1]/m[2];
  if((m=t.match(/^(\d*)([½⅓⅔¼¾⅛⅜⅝⅞])$/)))return(+m[1]||0)+FRAC[m[2]];
  return parseFloat(t);
}
const NICE=[[0,''],[1/8,'1/8'],[1/4,'1/4'],[1/3,'1/3'],[3/8,'3/8'],[1/2,'1/2'],[5/8,'5/8'],[2/3,'2/3'],[3/4,'3/4'],[7/8,'7/8'],[1,'']];
function fmtQty(x){
  let whole=Math.floor(x+1e-9),fr=x-whole,best=NICE[0],d=9;
  for(const n of NICE){const k=Math.abs(n[0]-fr);if(k<d){d=k;best=n}}
  if(best[0]===1){whole++;best=NICE[0]}
  if(!whole&&!best[1])return'1/8';
  return[whole||'',best[1]].filter(Boolean).join(' ');
}
function scaleLine(t,f){
  if(Math.abs(f-1)<1e-9)return t;
  const lead=new RegExp(String.raw`^(${NUMSRC})(?:(\s*(?:-|–|to)\s*)(${NUMSRC}))?`);
  let out=t.replace(lead,(m,a,sep,b)=>fmtQty(parseQty(a)*f)+(b?sep+fmtQty(parseQty(b)*f):''));
  out=out.replace(/\((about|approx\.?|roughly|around)\s+([^)]*)\)/gi,(m,w,inner)=>'('+w+' '+inner.replace(new RegExp(NUMSRC,'g'),n=>fmtQty(parseQty(n)*f))+')');
  return out;
}
function scaleInit(r){
  S.checked=new Set();S.f=1;
  const y=String(r.yield||'');
  let m=y.match(/^\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(.*)$/i);
  if(m){S.base=+m[1];S.label=m[2].trim()||'servings'}
  else if((m=y.match(/(\d+(?:\.\d+)?)/))){S.base=+m[1];S.label='servings'}
  else{S.base=0;S.label=''}
  S.target=S.base;
}
/* ---------- Meals made of other recipes ---------- */
const partsOf=r=>(r.parts||[]).map(sl=>S.demo.find(x=>x.slug===sl)).filter(Boolean);
const isMeal=r=>partsOf(r).length>0;
function allParts(r,seen=new Set([r.slug]),out=[]){
  (r.parts||[]).forEach(sl=>{if(seen.has(sl))return;const p=S.demo.find(x=>x.slug===sl);if(!p)return;seen.add(sl);allParts(p,seen,out);out.push(p)});
  return out;
}
const usedIn=r=>S.demo.filter(x=>x.slug!==r.slug&&(x.parts||[]).includes(r.slug));
function ingItems(r){
  const o=r.ingredients.map((t,i)=>({k:'o'+i,t,g:''}));
  allParts(r).forEach((p,pi)=>p.ingredients.forEach((t,i)=>o.push({k:'p'+pi+'-'+i,t,g:p.name})));
  return o;
}
function stepItems(r){
  const o=[];
  allParts(r).forEach(p=>p.steps.forEach(t=>o.push({t,from:p.name})));
  r.steps.forEach(t=>o.push({t,from:''}));
  return o;
}
function ingListHTML(pre){
  const r=S.cur;
  const items=ingItems(r);
  if(!items.length)return'<p class="note">No ingredients written down yet.</p>';
  let last='';
  return`<ul>${items.map(it=>{
    let h='';if(it.g!==last){last=it.g;if(it.g)h=`<li class="grp">${esc(it.g)}</li>`}
    return h+`<li><label for="${pre}${it.k}"><input type="checkbox" id="${pre}${it.k}" data-ing="${it.k}" ${S.checked.has(it.k)?'checked':''}><span>${esc(scaleLine(it.t,S.f))}</span></label></li>`;
  }).join('')}</ul>`;
}
function applyScale(){
  S.f=S.base>0?S.target/S.base:1;
  const sv=$('#sval');if(sv)sv.textContent=S.target;
  const w=$('#ing-wrap');if(w)w.innerHTML=ingListHTML('ing');
  const fy=$('#fact-yield');if(fy)fy.textContent=S.target+' '+S.label;
  if(CK.on)cookRender();
}

/* ---------- Timers ---------- */
const UNITRE='(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)';
const DURRE=new RegExp('(\\d+(?:\\.\\d+)?)(?:\\s*(?:to|-|–)\\s*(\\d+(?:\\.\\d+)?))?\\s*('+UNITRE+')\\b(?:(?:\\s*(?:and|,)?\\s*)(\\d+(?:\\.\\d+)?)\\s*('+UNITRE+')\\b)?','gi');
const unitMul=u=>/^h/i.test(u)?3600:/^m/i.test(u)?60:1;
const durSec=(n,u,n2,u2)=>Math.round(n*unitMul(u)+(n2?n2*unitMul(u2):0));
function stepHTML(t){
  let out='',last=0;
  t.replace(DURRE,(m,a,b,u,a2,u2,off)=>{
    out+=esc(t.slice(last,off));
    out+=`<button type="button" class="dur" data-act="timer" data-sec="${durSec(+a,u,a2&&+a2,u2)}" data-label="${esc(m)}" title="Start a timer">${esc(m)}</button>`;
    last=off+m.length;return m;
  });
  return out+esc(t.slice(last));
}
const TM={list:[],loop:0,alarm:0,sig:'',AC:null,title:document.title};
const fmtClock=s=>{s=Math.max(0,Math.ceil(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const fmtDur=sec=>sec>=3600?(Math.round(sec/360)/10)+' hr':(Math.round(sec/6)/10)+' min';
function tmSave(){store.set('rb_timers',JSON.stringify(TM.list.filter(t=>t.state!=='done')))}
function tmLoad(){
  try{
    const a=JSON.parse(store.get('rb_timers'));
    if(Array.isArray(a))TM.list=a.filter(t=>t&&t.id&&((t.state==='run'&&Number(t.end)>0)||(t.state==='pause'&&Number(t.left)>=0)));
  }catch{}
  if(TM.list.length){tmRender();ensureLoop()}
}
function ensureLoop(){if(!TM.loop)TM.loop=setInterval(tmTick,250)}
function beep(){
  try{
    TM.AC=TM.AC||new(window.AudioContext||window.webkitAudioContext)();
    const ac=TM.AC;if(ac.resume)ac.resume();
    const t=ac.currentTime;
    [0,.35,.7].forEach(d=>{
      const o=ac.createOscillator(),g=ac.createGain();
      o.type='sine';o.frequency.value=880;
      g.gain.setValueAtTime(.0001,t+d);g.gain.exponentialRampToValueAtTime(.3,t+d+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d+.3);
      o.connect(g);g.connect(ac.destination);o.start(t+d);o.stop(t+d+.32);
    });
  }catch{}
}
function alarmStart(){
  if(TM.alarm)return;
  let n=0;
  const go=()=>{beep();try{navigator.vibrate&&navigator.vibrate([300,150,300])}catch{}if(++n>=20)alarmStop()};
  go();TM.alarm=setInterval(go,3000);
  document.title='Timer done · '+TM.title;
}
function alarmStop(){clearInterval(TM.alarm);TM.alarm=0;document.title=TM.title}
function tmStart(sec,label){
  if(!(sec>0))return;
  try{TM.AC=TM.AC||new(window.AudioContext||window.webkitAudioContext)();TM.AC.resume&&TM.AC.resume()}catch{}
  TM.list.push({id:uuid(),label:label||fmtDur(sec),total:sec,end:Date.now()+sec*1000,state:'run'});
  tmSave();ensureLoop();tmRender();
  toast('Timer started: '+(label||fmtDur(sec)));
}
function tmTick(){
  const now=Date.now();let fired=false;
  for(const t of TM.list)if(t.state==='run'&&now>=t.end){t.state='done';fired=true}
  if(fired){tmSave();alarmStart()}
  tmRender();
  if(!TM.list.some(t=>t.state==='run')){clearInterval(TM.loop);TM.loop=0}
}
function tmRender(){
  const tray=$('#tray');if(!tray)return;
  const sig=TM.list.map(t=>t.id+t.state).join('|');
  if(sig!==TM.sig){
    TM.sig=sig;
    tray.innerHTML=TM.list.map(t=>`<div class="tmr ${t.state}" data-id="${esc(t.id)}"><span class="t" data-t></span><span class="l">${esc(t.label)}</span><div class="b">${
      t.state==='done'?`<button data-act="tstop" data-id="${esc(t.id)}">Dismiss</button>`
      :(t.state==='run'?`<button data-act="tpause" data-id="${esc(t.id)}">Pause</button>`:`<button data-act="tresume" data-id="${esc(t.id)}">Resume</button>`)+`<button data-act="tstop" data-id="${esc(t.id)}">Stop</button>`
    }</div></div>`).join('');
  }
  for(const t of TM.list){
    const el=tray.querySelector(`[data-id="${t.id}"] [data-t]`);
    if(el)el.textContent=t.state==='done'?'Done!':fmtClock(t.state==='run'?(t.end-Date.now())/1000:t.left);
  }
}
function tmAct(a,id){
  const t=TM.list.find(x=>x.id===id);if(!t)return;
  if(a==='tpause'){t.left=Math.ceil((t.end-Date.now())/1000);t.state='pause'}
  else if(a==='tresume'){t.end=Date.now()+t.left*1000;t.state='run';ensureLoop()}
  else if(a==='tstop'){TM.list=TM.list.filter(x=>x!==t);if(!TM.list.some(x=>x.state==='done'))alarmStop()}
  tmSave();tmRender();
}
function openTimerDialog(){
  const d=$('#tdlg');
  $('#tmin').value=10;$('#tlab').value='';d.returnValue='';
  d.addEventListener('close',()=>{
    if(d.returnValue!=='go')return;
    const m=parseFloat($('#tmin').value);
    if(m>0)tmStart(Math.round(m*60),$('#tlab').value.trim()||fmtDur(m*60));else toast('Enter how many minutes.');
  },{once:true});
  d.showModal();
}

/* ---------- Cook mode ---------- */
const CK={on:false,i:0,sheet:false,wl:null,x:0,y:0};
async function wakeOn(){try{if('wakeLock' in navigator)CK.wl=await navigator.wakeLock.request('screen')}catch{}}
function wakeOff(){try{CK.wl&&CK.wl.release()}catch{}CK.wl=null}
document.addEventListener('visibilitychange',()=>{if(CK.on&&document.visibilityState==='visible')wakeOn()});
function cookOpen(){
  const r=S.cur;
  if(!r||!stepItems(r).length){toast('This recipe has no steps yet.');return}
  CK.on=true;CK.i=0;CK.sheet=false;
  let el=$('#cook');
  if(!el){el=document.createElement('div');el.id='cook';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Cook mode');document.body.appendChild(el)}
  document.body.style.overflow='hidden';
  cookRender();wakeOn();
}
function cookClose(){
  CK.on=false;const el=$('#cook');if(el)el.remove();
  document.body.style.overflow='';wakeOff();
}
function cookRender(){
  const el=$('#cook'),r=S.cur;if(!el||!r)return;
  const SI=stepItems(r),n=SI.length,i=CK.i,showIngs=(i===0||CK.sheet),cs=SI[i-1];
  el.innerHTML=`<div class="wrap">
    <div class="ck-top"><div><p class="eyebrow">${esc(r.name)}</p><p class="ck-count">${i===0?'Gather your ingredients':'Step '+i+' of '+n}</p></div><button class="btn soft" data-act="ckexit">Exit</button></div>
    <div class="ck-bar" aria-hidden="true"><span style="width:${Math.round(i/n*100)}%"></span></div>
    <div class="ck-main">${showIngs?`<section class="ings"><h2>Ingredients${S.base>0&&S.f!==1?' (for '+esc(S.target+' '+S.label)+')':''}</h2>${ingListHTML('ck')}</section>`:`<p class="ck-step">${cs&&cs.from?`<span class="ck-from">${esc(cs.from)}</span>`:''}${stepHTML(cs?cs.t:'')}</p>`}</div>
    <div class="ck-nav">
      <button class="btn soft" data-act="ckprev" ${i===0?'disabled':''}>Back</button>
      ${i>0?`<button class="btn soft" data-act="ckings">${CK.sheet?'Back to the step':'Ingredients'}</button>`:''}
      <button class="btn go" data-act="cknext">${i===n?'Finished':(i===0?'Start cooking':'Next step')}</button>
    </div></div>`;
  el.scrollTop=0;
}
function cookGo(d){
  const n=stepItems(S.cur).length,j=CK.i+d;
  if(j>n){cookClose();toast('Enjoy your meal!');return}
  if(j<0)return;
  CK.i=j;CK.sheet=false;cookRender();
}
document.addEventListener('keydown',e=>{
  if(!CK.on)return;
  if(e.key==='ArrowRight')cookGo(1);
  else if(e.key==='ArrowLeft')cookGo(-1);
  else if(e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();cookClose()}
});
document.addEventListener('touchstart',e=>{if(CK.on&&e.touches[0]){CK.x=e.touches[0].clientX;CK.y=e.touches[0].clientY}},{passive:true});
document.addEventListener('touchend',e=>{
  if(!CK.on||!e.changedTouches[0]||e.target.closest('button'))return;
  const dx=e.changedTouches[0].clientX-CK.x,dy=e.changedTouches[0].clientY-CK.y;
  if(Math.abs(dx)>80&&Math.abs(dy)<60)cookGo(dx<0?1:-1);
},{passive:true});

/* ---------- What's for dinner? ---------- */
const ND={last:'',fav:false};
function ndOpen(){
  const d=$('#ndlg');ndBook();
  if(!d.open)d.showModal();
}
function ndBook(){
  const body=$('#ndbody');
  const pool=ND.fav?S.demo.filter(r=>r.fav):S.demo;
  const row=extra=>`<div class="row">${extra}<button type="button" class="btn quiet" data-act="ndclose">Close</button></div>`;
  const toggle=`<label class="chk"><input type="checkbox" id="ndfav" ${ND.fav?'checked':''}> Only hearted recipes</label>`;
  if(!pool.length){
    body.innerHTML=`<p class="hint">${ND.fav?'No hearted recipes yet. Heart a few, or turn that off.':'Your book is empty. Add a recipe first.'}</p>${toggle}${row('')}`;return;
  }
  let r;do{r=pool[Math.random()*pool.length|0]}while(pool.length>1&&r.slug===ND.last);
  ND.last=r.slug;
  body.innerHTML=`<p class="eyebrow">From your book</p><div class="photo">${imgTag(r.image,'')}</div><h3>${esc(r.name)}</h3><p class="meta">${esc(metaLine(r))}</p>${toggle}
  ${row(`<a class="btn" href="#/recipe/${encodeURIComponent(r.slug)}" data-act="ndclose">Open this recipe</a><button type="button" class="btn soft" data-act="ndagain">Another one</button>`)}`;
}
/* ---------- views ---------- */
function masthead(){
  return `<header class="masthead"><div class="topline"><button class="btn quiet gear" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>Settings</button></div><p class="script">from our kitchen to yours</p><h1 class="book-title"><a href="#/">The Family Recipe Book</a></h1>${divider()}</header>`;
}
const slim=(extra='')=>`<div class="slim"><a class="btn soft" href="#/">&larr; All recipes</a><span class="t"><a href="#/">The Family Recipe Book</a></span>${extra}</div>`;

async function renderHome(){
  app.innerHTML=masthead()+`
  <div class="controls">
    <input class="search" id="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Search by name or ingredient" aria-label="Search recipes" value="${esc(S.query)}">
    <button class="btn soft" id="onlyfav" aria-pressed="${S.onlyFavs}" data-act="onlyfav">Hearted</button>
    <button class="btn soft" data-act="dinner">What's for dinner?</button>
    <a class="btn" href="#/new">Add a recipe</a>
    <a class="btn soft" href="#/cookbook">Make a cookbook</a>
  </div>
  <div class="fchips types" role="group" aria-label="Show"><button type="button" class="fchip" data-act="rtype" data-t="" aria-pressed="${!S.type}">All</button><button type="button" class="fchip" data-act="rtype" data-t="dish" aria-pressed="${S.type==='dish'}">Dishes</button><button type="button" class="fchip" data-act="rtype" data-t="meal" aria-pressed="${S.type==='meal'}">Meals</button></div>
  <div class="chips" id="chips"></div>
  <ul class="grid" id="grid"></ul>
  <div id="more"></div>`;
  window.scrollTo(0,0);
  API().categories().then(cs=>{
    S.cats=cs;
    const chips=$('#chips');if(!chips)return;
    chips.innerHTML=[`<button class="chip" data-cat="" aria-pressed="${!S.cat}">All</button>`].concat(cs.map(c=>`<button class="chip" data-cat="${esc(c.slug)}" aria-pressed="${S.cat===c.slug}">${esc(c.name)}</button>`)).join('');
  }).catch(()=>{});
  let t;
  $('#q').addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>{S.query=e.target.value.trim();loadGrid(false)},350)});
  loadGrid(false);
}
const metaLine=r=>[r.total,r.yield,(!r.total&&!r.yield)?r.categories[0]:''].filter(Boolean).join(' · ');
const card=r=>`<li><a class="card" href="#/recipe/${encodeURIComponent(r.slug)}"><div class="photo">${imgTag(r.image,'')}</div><h3>${esc(r.name)}${isFav(r)?HEART:''}</h3><p class="meta">${esc((isMeal(r)?'Meal · ':'')+metaLine(r))}</p></a></li>`;
async function loadGrid(append){
  const grid=$('#grid'),more=$('#more');if(!grid)return;
  const my=loadGrid.n=(loadGrid.n||0)+1;
  if(!append){S.page=1;grid.innerHTML='';more.innerHTML='<p class="note">Turning the pages…</p>'}
  try{
    const r=await API().list({page:S.page,query:S.query,cat:S.cat,favs:S.onlyFavs,type:S.type});
    if(my!==loadGrid.n||!$('#grid'))return;
    S.totalPages=r.totalPages;
    grid.insertAdjacentHTML('beforeend',r.items.map(card).join(''));
    if(!grid.children.length){
      more.innerHTML=`<div class="empty"><h2>${S.query||S.cat||S.onlyFavs||S.type?'Nothing on that page':'The first page is waiting'}</h2><p class="hint">${S.query||S.cat||S.onlyFavs||S.type?'Try a different search or clear the filters.':'Add the first recipe to start your book.'}</p>${S.query||S.cat||S.onlyFavs?'':'<a class="btn" href="#/new">Add a recipe</a>'}</div>`;
    }else if(S.page<S.totalPages){more.innerHTML='<button class="btn soft" data-act="more">Show more recipes</button>'}
    else more.innerHTML='';
  }catch(e){
    if(e.message==='AUTH'||my!==loadGrid.n)return;
    more.innerHTML=`<p class="err" role="alert">${esc(errMsg(e))}</p>`;
  }
}

function partsSection(r){
  const ps=partsOf(r),ui=usedIn(r);
  const card=p=>`<li><a class="pcard" href="#/recipe/${encodeURIComponent(p.slug)}"><span class="photo">${imgTag(p.image,'')}</span><span class="pn">${esc(p.name)}</span></a></li>`;
  return (ps.length?`<section class="parts"><h2>Made from</h2><ul>${ps.map(card).join('')}</ul></section>`:'')
    +(ui.length?`<section class="parts"><h2>Part of</h2><ul>${ui.map(card).join('')}</ul></section>`:'');
}
async function renderRecipe(slug){
  app.innerHTML=slim()+'<p class="note">Finding the page…</p>';
  window.scrollTo(0,0);
  let r;
  try{r=await API().get(slug)}catch(e){
    if(e.message==='AUTH')return;
    app.innerHTML=slim()+`<p class="err" role="alert">${esc(e.status===404?'I could not find that recipe. It may have been removed.':errMsg(e))}</p>`;return;
  }
  S.cur=r;scaleInit(r);
  const facts=[['Prep',r.prep],['Cook',r.cook],['Total',r.total],['Makes',r.yield]].filter(f=>f[1]);
  app.innerHTML=slim()+`<article class="recipe">
  <header>
    ${(r.categories.length||isMeal(r))?`<p class="eyebrow">${esc((isMeal(r)?['Meal'].concat(r.categories):r.categories).join(' · '))}</p>`:''}
    <h1>${esc(r.name)}</h1>
    ${r.description?`<p class="desc">${esc(r.description)}</p>`:''}
    ${facts.length?`<dl class="facts">${facts.map(f=>`<div><dt>${f[0]}</dt><dd${f[0]==='Makes'?' id="fact-yield"':''}>${esc(f[1])}</dd></div>`).join('')}</dl>`:''}
    <div class="toolbar">
      <button class="btn cook" data-act="cook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2 11h2M20 11h2M8 7c0-1.5 1.5-1.5 1.5-3M13 7c0-1.5 1.5-1.5 1.5-3"/></svg>Cook mode</button>
      <button class="btn timer" data-act="tdlg"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>Timer</button>
      <a class="btn edit" href="#/edit/${encodeURIComponent(r.slug)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>Edit</a>
      <button class="btn heart" data-act="fav" aria-pressed="${isFav(r)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg><span>${isFav(r)?'Hearted':'Heart it'}</span></button>
      <button class="btn print" data-act="print"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/></svg>Print</button>
      <button class="btn quiet" data-act="del">Remove</button>
    </div>
  </header>
  ${r.image?`<figure class="hero"><div class="photo">${imgTag(r.image,r.name)}</div></figure>`:''}
  ${partsSection(r)}
  <div class="cols">
    <section class="ings"><h2>Ingredients</h2>${S.base>0?`<div class="scaler"><span class="lab">Makes</span><button class="sb" data-act="sdown" aria-label="Make less">&minus;</button><output id="sval">${S.target}</output><button class="sb" data-act="sup" aria-label="Make more">+</button><span id="slab">${esc(S.label)}</span><button class="btn quiet" data-act="sreset">Reset</button></div>`:''}<div id="ing-wrap">${ingListHTML('ing')}</div></section>
    <section class="steps"><h2>Method</h2>${r.steps.length?`<ol>${r.steps.map(t=>`<li><p>${stepHTML(t)}</p></li>`).join('')}</ol>`:(isMeal(r)?'<p class="note">Open each dish above for its method, or tap Cook mode to go through them in order.</p>':'<p class="note">No steps written down yet.</p>')}</section>
  </div>
  ${r.notes?`<aside class="margin-note"><p class="script">a note in the margin</p><p class="hand">${esc(r.notes)}</p></aside>`:''}
  ${r.source?`<p class="src">Adapted from <a href="${esc(/^https?:\/\//i.test(r.source)?r.source:'#')}" target="_blank" rel="noopener noreferrer">${esc(r.source)}</a></p>`:''}
  </article>`;
}

let FP=[];
function partsPaint(){
  const me=S.cur&&S.cur.slug,qi=$('#f-partq'),res=$('#f-partres'),box=$('#f-parts');if(!qi||!res||!box)return;
  const q=qi.value.trim().toLowerCase();
  const cand=S.demo.filter(x=>x.slug!==me&&!FP.includes(x.slug)&&!(me&&allParts(x).some(y=>y.slug===me)));
  const hit=cand.filter(x=>!q||(x.name+' '+x.categories.join(' ')).toLowerCase().includes(q));
  res.innerHTML=hit.length?hit.map(x=>`<li><button type="button" data-act="partadd" data-s="${esc(x.slug)}"><span>${esc(x.name)}</span><span class="plus" aria-hidden="true">+ Add</span></button></li>`).join(''):`<li class="none">${cand.length?'Nothing matches that search.':'No other recipes to add yet.'}</li>`;
  box.innerHTML=FP.map(sl=>{const p=S.demo.find(x=>x.slug===sl);return p?`<span class="pchip">${esc(p.name)}<button type="button" data-act="partrm" data-s="${esc(sl)}" aria-label="Remove ${esc(p.name)}">&times;</button></span>`:''}).join('');
}
async function renderEditor(slug){
  app.innerHTML=slim()+'<p class="note">Getting a clean page…</p>';
  window.scrollTo(0,0);
  let r={name:'',description:'',yield:'',prep:'',cook:'',total:'',ingredients:[],steps:[],categories:[],tags:[],notes:'',source:'',image:''};
  if(slug){
    try{r=await API().get(slug)}catch(e){if(e.message!=='AUTH')app.innerHTML=slim()+`<p class="err" role="alert">${esc(errMsg(e))}</p>`;return}
  }
  S.cur=slug?r:null;FP=(r.parts||[]).filter(sl=>S.demo.some(x=>x.slug===sl));
  app.innerHTML=slim()+`<section class="editor"><h1>${slug?'Edit this recipe':'A new recipe'}</h1>
  <form autocomplete="off" id="rform" class="paper" data-slug="${esc(slug||'')}" novalidate>
    <p class="err" id="ferr" role="alert" hidden></p>
    <div class="field"><label for="f-name">Recipe name</label><input id="f-name" type="text" value="${esc(r.name)}" required></div>
    <div class="field"><label for="f-desc">A few words about it</label><textarea id="f-desc" style="min-height:90px">${esc(r.description)}</textarea></div>
    <div class="pick"><label>Photo</label>
      <div class="photo" id="prev">${imgTag(r.image,'')}</div>
      <input type="file" id="f-img" accept="image/*"><label class="btn soft" for="f-img" style="text-transform:uppercase">${r.image?'Change the photo':'Add a photo'}</label>
    </div>
    <div class="two">
      <div class="field"><label for="f-prep">Prep time</label><input id="f-prep" type="text" placeholder="15 minutes" value="${esc(r.prep)}"></div>
      <div class="field"><label for="f-cook">Cook time</label><input id="f-cook" type="text" placeholder="1 hour" value="${esc(r.cook)}"></div>
      <div class="field"><label for="f-total">Total time</label><input id="f-total" type="text" placeholder="1 hour 15 minutes" value="${esc(r.total)}"></div>
      <div class="field"><label for="f-yield">Makes</label><input id="f-yield" type="text" placeholder="6 servings" value="${esc(r.yield)}"></div>
    </div>
    <div class="field"><label for="f-partq">Made from other recipes (optional)</label>
      <div class="pchips" id="f-parts"></div>
      <input id="f-partq" type="search" autocomplete="off" autocapitalize="off" enterkeyhint="search" placeholder="Search your recipes to add" aria-describedby="f-parthint" aria-controls="f-partres">
      <ul class="partres" id="f-partres" aria-label="Recipes you can add"></ul>
      <p class="hint" id="f-parthint">Pick recipes you already have, like Quinoa flakes and Peas sauce. A recipe made from other recipes becomes a Meal. Each one on its own stays a Dish.</p></div>
    <div class="field"><label for="f-ing">Ingredients (one per line)</label><textarea id="f-ing" placeholder="2 cups flour&#10;1 egg">${esc(r.ingredients.join('\n'))}</textarea></div>
    <div class="field"><label for="f-steps">Method (one step per line)</label><textarea id="f-steps" style="min-height:200px" placeholder="Heat the oven to 350°F.">${esc(r.steps.join('\n\n'))}</textarea></div>
    <div class="two">
      <div class="field"><label for="f-cats">Categories (commas between)</label><input id="f-cats" type="text" placeholder="Dessert, Baking" value="${esc(r.categories.join(', '))}"></div>
      <div class="field"><label for="f-tags">Tags (commas between)</label><input id="f-tags" type="text" placeholder="Holiday, Family favorite" value="${esc(r.tags.join(', '))}"></div>
    </div>
    <div class="field"><label for="f-notes">A note in the margin</label><textarea id="f-notes" style="min-height:100px" placeholder="What to remember next time">${esc(r.notes)}</textarea></div>
    <div class="field"><label for="f-src">Where it came from (a web address, if any)</label><input id="f-src" type="text" inputmode="url" value="${esc(r.source)}"></div>
    <div class="row"><button class="btn" id="fsave" type="submit">Save to my book</button><a class="btn quiet" href="${slug?'#/recipe/'+encodeURIComponent(slug):'#/'}">Cancel</a></div>
  </form></section>`;
  partsPaint();
  $('#f-partq').addEventListener('input',partsPaint);
  $('#f-partq').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const f=document.querySelector('#f-partres [data-act=partadd]');if(f)f.click()}});
  $('#f-img').addEventListener('change',e=>{
    const f=e.target.files[0];if(!f)return;
    $('#prev').innerHTML=`<img src="${URL.createObjectURL(f)}" alt="Preview of the chosen photo">`;
  });
}

/* ---------- router ---------- */
/* ---------- Cookbook maker (a separate file, cookbook.js, loaded only when it is opened) ---------- */
let cbLoading=null;
function loadCookbook(){
  if(window.RBCookbook)return Promise.resolve();
  if(!cbLoading)cbLoading=new Promise((res,rej)=>{
    const sc=document.createElement('script');sc.src='cookbook.js?v='+VERSION;
    sc.onload=()=>res();sc.onerror=()=>{cbLoading=null;sc.remove();rej(new Error('LOAD'))};
    document.head.appendChild(sc);
  });
  return cbLoading;
}
async function renderCookbook(){
  app.innerHTML=slim()+'<p class="note">Opening the cookbook maker…</p>';
  window.scrollTo(0,0);
  try{await loadCookbook()}catch{
    app.innerHTML=slim()+'<p class="err" role="alert">I could not load the cookbook maker. Its file, cookbook.js, needs to sit in the same folder as this page. Check your connection and try again.</p>';return;
  }
  if(!/^#\/cookbook/.test(location.hash))return;
  RBCookbook.mount(app,{
    header:()=>slim(),
    recipes:()=>S.demo,
    toast,
    exit:()=>{location.hash='#/'},
    author:''
  });
}
function route(){
  if(window.RBCookbook)RBCookbook.unmount();
  if(CK.on)cookClose();
  const p=(location.hash.slice(1)||'/').split('/').filter(Boolean);
  const arg=p[1]?decodeURIComponent(p[1]):'';
  if(p[0]==='recipe'&&arg)return renderRecipe(arg);
  if(p[0]==='new')return renderEditor(null);
  if(p[0]==='edit'&&arg)return renderEditor(arg);
  if(p[0]==='cookbook')return renderCookbook();
  return renderHome();
}
window.addEventListener('hashchange',route);

/* ---------- events ---------- */
const lines=(s,bullets)=>s.split(/\n+/).map(x=>x.trim().replace(bullets?/^([-*•]\s+)/:/^(\d+[.)]\s+|[-*•]\s+)/,'')).filter(Boolean);
const csv=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
function confirmBox(msg,yes,no){
  return new Promise(res=>{
    const d=$('#dlg');$('#dlgmsg').textContent=msg;$('#dlgyes').textContent=yes||'Remove it';$('#dlgno').textContent=no||'Keep it';
    d.addEventListener('close',()=>res(d.returnValue==='yes'),{once:true});
    d.showModal();
  });
}

document.addEventListener('click',async e=>{
  const cl=e.target.closest('[data-close]');
  if(cl){const d=cl.closest('dialog');if(d)d.close(cl.dataset.close);return}
  const chip=e.target.closest('.chip');
  if(chip){S.cat=chip.dataset.cat;document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',c===chip));loadGrid(false);return}
  const b=e.target.closest('[data-act]');if(!b)return;
  const a=b.dataset.act;
  if(a==='settings'){$('#sver').textContent='The Family Recipe Book '+VERSION+' (Family Circle)';$('#sdlg').showModal();return}
  if(a==='restore')return $('#restore').click();
  if(a==='backup'){
    const blob=new Blob([JSON.stringify({app:'family-recipe-book',version:1,saved:new Date().toISOString(),recipes:S.demo},null,1)],{type:'application/json'});
    const u=URL.createObjectURL(blob),l=document.createElement('a');
    l.href=u;l.download='recipe-book-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);
    toast('Backup saved to your downloads.');return;
  }
  if(a==='cook')return cookOpen();
  if(a==='ckexit')return cookClose();
  if(a==='ckprev')return cookGo(-1);
  if(a==='cknext')return cookGo(1);
  if(a==='ckings'){CK.sheet=!CK.sheet;return cookRender()}
  if(a==='sdown'){if(S.target>1)S.target--;return applyScale()}
  if(a==='sup'){S.target=Math.min(99,S.target+1);return applyScale()}
  if(a==='sreset'){S.target=S.base;return applyScale()}
  if(a==='timer')return tmStart(+b.dataset.sec,b.dataset.label);
  if(a==='tdlg')return openTimerDialog();
  if(a==='tpre'){$('#tmin').value=b.dataset.min;return}
  if(a==='tpause'||a==='tresume'||a==='tstop')return tmAct(a,b.dataset.id);
  if(a==='dinner')return ndOpen();
  if(a==='ndagain')return ndBook();
  if(a==='rtype'){S.type=b.dataset.t;document.querySelectorAll('.types .fchip').forEach(x=>x.setAttribute('aria-pressed',x===b));loadGrid(false);return}
  if(a==='partadd'){if(!FP.includes(b.dataset.s))FP.push(b.dataset.s);const qi=$('#f-partq');if(qi)qi.value='';partsPaint();return}
  if(a==='partrm'){FP=FP.filter(x=>x!==b.dataset.s);partsPaint();return}
  if(a==='ndclose'){$('#ndlg').close();return}
  if(a==='more'){S.page++;return loadGrid(true)}
  if(a==='onlyfav'){S.onlyFavs=!S.onlyFavs;b.setAttribute('aria-pressed',S.onlyFavs);return loadGrid(false)}
  if(a==='print')return window.print();
  if(a==='fav'){
    const r=S.cur;
    try{await API().fav(r,!isFav(r));b.setAttribute('aria-pressed',isFav(r));b.querySelector('span').textContent=isFav(r)?'Hearted':'Heart it'}
    catch(err){if(err.message!=='AUTH')toast(errMsg(err))}
    return;
  }
  if(a==='del'){
    const r=S.cur;
    if(!await confirmBox(`Remove “${r.name}” from your book? This cannot be undone.`))return;
    try{await API().remove(r);toast('Recipe removed.');location.hash='#/'}
    catch(err){if(err.message!=='AUTH')toast(errMsg(err))}
  }
});

document.addEventListener('submit',async e=>{
  const f=e.target;
  if(f.id==='rform'){
    e.preventDefault();
    const err=$('#ferr'),btn=$('#fsave'),name=$('#f-name').value.trim();
    if(!name){err.textContent='Give the recipe a name first.';err.hidden=false;$('#f-name').focus();return}
    const v={
      name,description:$('#f-desc').value.trim(),yield:$('#f-yield').value.trim(),prep:$('#f-prep').value.trim(),cook:$('#f-cook').value.trim(),total:$('#f-total').value.trim(),
      ingredients:lines($('#f-ing').value,true),steps:lines($('#f-steps').value,false),parts:FP.slice(),
      categories:csv($('#f-cats').value),tags:csv($('#f-tags').value),notes:$('#f-notes').value.trim(),source:$('#f-src').value.trim()
    };
    btn.disabled=true;btn.textContent='Saving…';err.hidden=true;
    try{
      const slug=await API().save(v,f.dataset.slug||null,$('#f-img').files[0]||null);
      toast('Saved to your book.');
      location.hash='#/recipe/'+encodeURIComponent(slug);
    }catch(ex){
      if(ex.message==='AUTH')return;
      err.textContent=errMsg(ex);err.hidden=false;btn.disabled=false;btn.textContent='Save to my book';
      err.scrollIntoView({block:'center'});
    }
  }
});

document.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='ndfav'){ND.fav=t.checked;ndBook();return}
  if(t.matches&&t.matches('input[data-ing]')){
    const i=t.dataset.ing;
    if(t.checked)S.checked.add(i);else S.checked.delete(i);
    document.querySelectorAll(`input[data-ing="${i}"]`).forEach(x=>{x.checked=t.checked});
  }
});
document.addEventListener('change',async e=>{
  if(e.target.id!=='restore')return;
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const d=JSON.parse(await f.text());
    const list=Array.isArray(d)?d:d.recipes;
    if(!Array.isArray(list)||!list.length||!list.every(r=>r&&typeof r.name==='string'))throw new Error('bad');
    let n=0;
    for(const r of list){
      const rec=cleanRecipe(r,Date.now());
      const i=S.demo.findIndex(x=>x.slug===rec.slug);
      if(i>=0)S.demo[i]=rec;else S.demo.push(rec);
      delete S.deleted[rec.slug];
      n++;
    }
    Book.persist();toast(`Restored ${n} recipe${n===1?'':'s'}.`);route();
  }catch{toast('That file does not look like a recipe book backup.')}
});

/* ---------- start ---------- */
decorate();
$('#ver').textContent=VERSION;
Gate.start(()=>{Book.boot();route();tmLoad()});
})();