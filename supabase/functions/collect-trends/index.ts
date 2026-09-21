import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SB_URL=Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const SECRET=SECRET_KEYS.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const YOUTUBE_API_KEY=Deno.env.get("YOUTUBE_API_KEY")||"";
function dec(s:string){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").trim()}
function tag(x:string,n:string){const m=x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`,"i"));return m?dec(m[1]):""}
function items(x:string){return[...x.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1])}
function key(s:string){return s.normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim().slice(0,240)}
const ALIASES:[RegExp,string][]=[
 [/ユニバーサル[・･\s]*スタジオ[・･\s]*ジャパン|universal studios japan|\busj\b/gi,"usj"],
 [/東京[・･\s]*ディズニー(ランド|リゾート|シー)|tokyo disney(resort|land|sea)?/gi,"東京ディズニー"],
 [/大阪[・･\s]*関西万博|関西万博|大阪万博|expo\s*2025/gi,"大阪関西万博"],
 [/東京ゲームショウ\s*2026|東京ゲームショウ|\btgs\s*2026\b/gi,"東京ゲームショウ2026"],
 [/東京ガールズコレクション\s*2026|東京ガールズコレクション|\btgc\s*2026\b/gi,"東京ガールズコレクション2026"]
];
const STOP=new Set(["速報","動画","公式","最新","ニュース","news","live","ライブ","について","まとめ","発表","日本","japan","the","and","今日","独自","映画","予告","new","be","group","時代","複数視点","video","music","performance","映像","最強","ガチ","更新","位置","チケット","スマホ","アニメ"]);
const ENTITY_ALIASES:[RegExp,string][]=[
 [/台風\s*25号|typhoon(?:\s+japan)?/gi,"台風25号"],
 [/グリーンランド/gi,"グリーンランド"],
 [/日銀|日本銀行/gi,"日銀"],
 [/モンスターストライク|モンスト/gi,"モンスト"],
 [/ウマ娘(?:\s*プリティーダービー)?/gi,"ウマ娘"],
 [/進撃の巨人|attack on titan/gi,"進撃の巨人"],
 [/藤井\s*風|fujii\s*kaze/gi,"藤井風"],
 [/櫻坂\s*46|櫻坂46|櫻坂/gi,"櫻坂46"],
 [/日向坂\s*46|日向坂46|日向坂/gi,"日向坂46"],
 [/le\s*sserafim|르세라핌/gi,"le sserafim"],
 [/aぇ!?\s*group/gi,"aぇ! group"],
 [/six\s*tones/gi,"sixtones"],
 [/bts/gi,"bts"],
 [/大谷翔平|大谷/gi,"大谷翔平"],
 [/山本由伸|ヨシノブ/gi,"山本由伸"],
 [/高市(?:首相|総理|早苗)?/gi,"高市早苗"],
 [/トランプ(?:氏|大統領|政権)?/gi,"トランプ"],
 [/プーチン(?:氏|大統領|政権)?/gi,"プーチン"],
 [/愛知[・･\s]*名古屋アジア大会|名古屋アジア大会|アジア競技大会|アジア大会/gi,"愛知名古屋アジア大会"],
 [/若林有子(?:アナウンサー|アナ)?/gi,"若林有子"],
 [/be[:：\s-]*first/gi,"be:first"],
 [/niziu|니쥬/gi,"niziu"],
 [/snow\s*man/gi,"snow man"],
 [/efootball|イーフットボール|イーフト/gi,"efootball"],
 [/マインクラフト|マイクラ|まいくら/gi,"マインクラフト"],
 [/apple\s*watch\s*ultra/gi,"apple watch ultra"],
 [/ultra\s*japan/gi,"ultra japan"],
 [/新\s*美味しんぼ/gi,"新 美味しんぼ"],
 [/クレヨンしんちゃん/gi,"クレヨンしんちゃん"],
 [/bleach/gi,"bleach"],
 [/名探偵プリキュア/gi,"名探偵プリキュア"],
 [/新日本プロレス/gi,"新日本プロレス"],
 [/中田(?:カウス[・･\s]*ボタンの)?ボタン|中田ボタン/gi,"中田ボタン"],
 [/オールカマー/gi,"オールカマー"],
 [/踊る大捜査線/gi,"踊る大捜査線"],
 [/#?surge\s*town/gi,"surge town"]
];
function clusterText(s:string){let x=s.normalize("NFKC").toLowerCase();for(const [re,to] of ALIASES)x=x.replace(re,to);for(const [re,to] of ENTITY_ALIASES)x=x.replace(re,to);return x.replace(/[【】\[\]（）()「」『』〈〉《》:：!！?？,，.。\-_/|｜]/g," ").replace(/\s+/g," ").trim()}
function tokens(s:string){const x=clusterText(s);const a=x.match(/[a-z0-9]{2,}|[ァ-ヶー]{2,}|[一-龯]{2,}/g)||[];return [...new Set(a.filter(v=>!STOP.has(v)))].slice(0,12)}
function tokenNear(a:string,b:string){
 if(a===b)return true;
 const min=Math.min(a.length,b.length),max=Math.max(a.length,b.length);
 if(min<5||min/max<0.8)return false;
 return a.includes(b)||b.includes(a)
}
function similarity(a:string,b:string){const A=tokens(a),B=tokens(b);if(!A.length||!B.length)return 0;let hit=0;for(const x of A)if(B.some(y=>tokenNear(x,y)))hit++;return hit/Math.max(A.length,B.length)}
function canonical(s:string){
 const raw=s.normalize("NFKC").trim();
 const series=raw.match(/^『([^』]{2,40})』(?:第\s*\d+\s*回|\s)/);
 if(series)return series[1].trim().slice(0,80);
 const stripped=raw.replace(/^【[^】]{1,40}】\s*/,"").replace(/\s+-\s+(?:Gizmodo|Yahoo!?ニュース|news\.yahoo\.co\.jp|オリコンニュース|ORICON NEWS|日本経済新聞|朝日新聞|読売新聞|産経ニュース|時事ドットコム|毎日新聞)\s*$/i,"");
 const x=clusterText(stripped);
 for(const [,to] of [...ALIASES,...ENTITY_ALIASES])if(x.includes(to))return to;
 // Preserve Japanese words with okurigana (e.g. 戦犯捜し) instead of truncating to kanji-only fragments.
 const a=x.match(/[a-z0-9]{2,}|[一-龯ぁ-んァ-ヶー]{2,}/g)||[];
 const t=[...new Set(a.filter(v=>!STOP.has(v)&&!/^\d+$/.test(v)))];
 return (t[0]||x).slice(0,80)
}
const ANCHOR_STOP=new Set(["活動休止","傷害容疑","逮捕報道","正式処分","事実関係","所属事務","所属事務所","女性への","被害女性","警視庁","お知らせ","朝日新聞","読売新聞","産経ニュース","時事通信","共同通信","毎日新聞","スポニチ","ニュース","news","yahoo","starto","sponichi","annex"]);
function anchors(s:string){
 const x=s.normalize("NFKC").toLowerCase(),out=new Set<string>();
 for(const m of x.matchAll(/[a-z][a-z0-9.+#-]{3,}/g)){const v=m[0];if(!STOP.has(v)&&!ANCHOR_STOP.has(v))out.add(v)}
 for(const m of x.matchAll(/[ァ-ヶー]{4,}/g)){const v=m[0];if(!ANCHOR_STOP.has(v))out.add(v)}
 for(const m of x.matchAll(/[一-龯]{4,}/g)){
  const run=m[0];
  for(let n=Math.min(6,run.length);n>=4;n--)for(let i=0;i+n<=run.length;i++){const v=run.slice(i,i+n);if(!ANCHOR_STOP.has(v)&&![...ANCHOR_STOP].some(z=>v.includes(z)||z.includes(v)))out.add(v)}
 }
 return [...out].slice(0,48)
}
function sharedAnchors(a:string,b:string){const A=anchors(a),B=new Set(anchors(b));return A.filter(x=>B.has(x)).sort((x,y)=>y.length-x.length)}
function anchorSimilarity(a:string,b:string){
 const shared=sharedAnchors(a,b),cjk=shared.filter(x=>/^[一-龯]+$/.test(x)),latin=shared.filter(x=>/^[a-z]/.test(x));
 if(cjk.some(x=>x.length>=5)&&latin.length)return .98;
 if(cjk.some(x=>x.length>=4)&&latin.length)return .95;
 if(cjk.some(x=>x.length>=6))return .92;
 if(cjk.filter(x=>x.length>=4).length>=2)return .88;
 if(cjk.some(x=>x.length>=4))return .76;
 if(latin.length>=2)return .72;
 return 0
}
function anchorLabel(a:string,b:string){
 const shared=sharedAnchors(a,b),cjk=shared.find(x=>/^[一-龯]+$/.test(x)&&x.length>=4),latin=shared.find(x=>/^[a-z]/.test(x));
 if(latin&&cjk)return `${latin} ${cjk}`.slice(0,80);
 if(cjk)return cjk.slice(0,80);
 if(latin)return latin.slice(0,80);
 return ""
}
const GENERIC_CLUSTER=new Set(["ゲーム","動画","ニュース","ライブ","映画","音楽","テレビ","公式","最新","アニメ","映像","最強","ガチ","独自","更新","位置","スマホ","チケット"]);
function genericKey(c:string){
 const x=String(c||"").trim().toLowerCase();
 return GENERIC_CLUSTER.has(x)||(/^[a-z0-9]+$/i.test(x)&&x.length<=3)||(/^[一-龯ぁ-んァ-ヶー]+$/.test(x)&&x.length<=2)
}
function priorityEventCluster(title:string){
 const x=title.normalize("NFKC").toLowerCase();
 const has=(...terms:string[])=>terms.some(t=>x.includes(t.toLowerCase()));
 if(has("トランプ")){
  if(has("グリーンランド","デンマーク"))return{cluster_key:"event:trump_greenland",cluster_label:"トランプ × グリーンランド",parent_key:"entity:trump",parent_label:"トランプ"};
  if(has("cnn","ホワイトハウス","取材禁止","記者証","締め出","排除"))return{cluster_key:"event:trump_media_access",cluster_label:"トランプ × メディア取材制限",parent_key:"entity:trump",parent_label:"トランプ"};
  if(has("習近平","習氏","米中","晩さん会","訪米","歓迎式典","国賓"))return{cluster_key:"event:trump_us_china",cluster_label:"トランプ × 米中首脳会談",parent_key:"entity:trump",parent_label:"トランプ"};
  if(has("ロシア","ウクライナ","対露","和平","制裁法"))return{cluster_key:"event:trump_russia_ukraine",cluster_label:"トランプ × ロシア・ウクライナ",parent_key:"entity:trump",parent_label:"トランプ"};
  if(has("aiフォース","ai フォース"))return{cluster_key:"event:trump_ai_force",cluster_label:"トランプ「AIフォース」",parent_key:"entity:trump",parent_label:"トランプ"};
 }
 if(has("高市")){
  if(has("人事","改造内閣","副大臣","政務官","国対","役職希望","閣内"))return{cluster_key:"event:takaichi_cabinet",cluster_label:"高市政権 人事・内閣改造",parent_key:"entity:takaichi",parent_label:"高市早苗"};
  if(has("支持率"))return{cluster_key:"event:takaichi_approval",cluster_label:"高市内閣 支持率",parent_key:"entity:takaichi",parent_label:"高市早苗"};
  if(has("利上げ","日銀","財政","市場","金利"))return{cluster_key:"event:takaichi_boj_fiscal",cluster_label:"高市財政 × 日銀・市場",parent_key:"entity:takaichi",parent_label:"高市早苗"};
  return{cluster_key:"event:takaichi_other",cluster_label:"高市早苗 その他の動き",parent_key:"entity:takaichi",parent_label:"高市早苗"};
 }
 if(has("習近平")){
  if(has("体調不良","倒れた","意識消失","脳梗塞","救急搬送","所在不明"))return{cluster_key:"event:xi_health_rumor",cluster_label:"習近平の体調不良説",parent_key:"entity:習近平",parent_label:"習近平"};
 }
 if(has("iphone")){
  if(has("iphone duo","折り畳み","折りたたみ","フォルダブル","fold"))return{cluster_key:"event:iphone_duo_foldable",cluster_label:"iPhone Duo・折り畳みiPhone",parent_key:"entity:iphone",parent_label:"iPhone"};
  if(has("iphone 18 pro","iphone18 pro","18 pro／pro max","18 pro/pro max"))return{cluster_key:"event:iphone18_pro",cluster_label:"iPhone 18 Pro",parent_key:"entity:iphone",parent_label:"iPhone"};
 }
 return null
}
async function findCluster(title:string){
 const forced=priorityEventCluster(title);if(forced)return{cluster_key:forced.cluster_key,cluster_label:forced.cluster_label,cluster_method:"event_child_v01",cluster_confidence:1,parent_key:forced.parent_key,parent_label:forced.parent_label};
 const c=canonical(title),recent=await rest("trend_topics?select=id,title,cluster_key,cluster_label&order=last_seen_at.desc&limit=300",{method:"GET"});
 let best:any=null,bestScore=0,bestAnchor=0;
 for(const r of recent||[]){
  const rc=canonical(r.title),aScore=anchorSimilarity(title,r.title);
  const cGeneric=genericKey(c),rcGeneric=genericKey(rc);
  const sim=similarity(title,r.title);
  let sc=(!cGeneric&&!rcGeneric&&(r.cluster_key===c||rc===c))?1:sim;
  if(!cGeneric&&c.length>=4&&clusterText(r.title).includes(c))sc=Math.max(sc,.85);
  if(!rcGeneric&&rc.length>=4&&clusterText(title).includes(rc))sc=Math.max(sc,.85);
  // Generic/short keys may merge only when the full titles are strongly similar or a strong anchor exists.
  if(cGeneric||rcGeneric)sc=Math.max(aScore,sim>=.75?sim:0);
  sc=Math.max(sc,aScore);
  if(sc>bestScore){best=r;bestScore=sc;bestAnchor=aScore}
 }
 if(best&&bestScore>=0.45){
  const stableKey=String(best.cluster_key||"");
  const stableLabel=/^(series|entity|event):/.test(stableKey);
  const label=stableLabel
    ? (best.cluster_label||canonical(best.title))
    : bestAnchor>=0.72
      ? (anchorLabel(title,best.title)||best.cluster_label||canonical(best.title))
      : (best.cluster_label||canonical(best.title));
  return{cluster_key:best.cluster_key||canonical(best.title),cluster_label:label,cluster_method:bestAnchor>=0.72?"anchor_v06":"heuristic_v06",cluster_confidence:Math.round(bestScore*100)/100}
 }
 return{cluster_key:c,cluster_label:c,cluster_method:"heuristic_v05",cluster_confidence:1}
}
function num(s:string){const m=s.replace(/,/g,"").toUpperCase().match(/([0-9.]+)\s*([KMB万億]?)/);if(!m)return null;let n=+m[1];if(m[2]==="K")n*=1e3;if(m[2]==="M")n*=1e6;if(m[2]==="B")n*=1e9;if(m[2]==="万")n*=1e4;if(m[2]==="億")n*=1e8;return n}
async function rest(path:string,init:RequestInit={}){if(!SECRET)throw new Error("server secret unavailable");const h=new Headers(init.headers);h.set("apikey",SECRET);h.set("Authorization",`Bearer ${SECRET}`);h.set("Content-Type","application/json");const r=await fetch(`${SB_URL}/rest/v1/${path}`,{...init,headers:h});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);const t=await r.text();return t?JSON.parse(t):null}
async function topic(title:string,source:string,score:number,meta:any={}){
 const k=key(title);
 const existing=await rest(`trend_topics?topic_key=eq.${encodeURIComponent(k)}&select=*`,{method:"GET"});
 const old=existing?.[0]||{};
 const detected=await findCluster(title);
 const oldKey=String(old.cluster_key||""),oldMethod=String(old.cluster_method||"");
 const newKey=String((detected as any).cluster_key||""),newMethod=String((detected as any).cluster_method||"");
 const oldHardStable=/^(event:|series:)/.test(oldKey)||/^(audit_|manual_repair_|event_child_)/.test(oldMethod);
 const oldEntityStable=/^entity:/.test(oldKey);
 const newIsEvent=/^event:/.test(newKey)||/^event_child_/.test(newMethod);
 let cluster:any=detected;
 // Stable clusters must not drift back to heuristic/anchor matches on later collections.
 // Entity parents may still be promoted to an explicit event child, but otherwise remain stable.
 if(oldKey&&((oldHardStable&&newKey!==oldKey)||(oldEntityStable&&!newIsEvent&&newKey!==oldKey))){
  cluster={cluster_key:old.cluster_key,cluster_label:old.cluster_label||old.cluster_key,cluster_method:old.cluster_method||"stable_existing",cluster_confidence:Number(old.cluster_confidence||1)}
 }else if(oldKey&&newKey===oldKey&&(oldHardStable||oldEntityStable)){
  cluster={...detected,cluster_key:old.cluster_key,cluster_label:old.cluster_label||((detected as any).cluster_label||old.cluster_key),cluster_method:old.cluster_method||((detected as any).cluster_method||"stable_existing"),cluster_confidence:Number(old.cluster_confidence||((detected as any).cluster_confidence||1))}
 }
 const g=source==="google"?score:Number(old.google_score||0);
 const y=source==="youtube"?score:Number(old.youtube_score||0);
 const n=source==="news"?score:Number(old.news_score||0);
 const sourceCount=[g,y,n].filter(v=>v>0).length;
 const bonus=sourceCount>=3?20:sourceCount===2?10:0;
 const weighted=g*.4+y*.3+n*.3;
 const trendScore=Math.min(100,Math.round((weighted+bonus)*100)/100);
 const p:any={topic_key:k,title,last_seen_at:new Date().toISOString(),status:"active",metadata:{...(old.metadata||{}),source_last:source,...meta,...((cluster as any).parent_key?{parent_key:(cluster as any).parent_key,parent_label:(cluster as any).parent_label}:{})},google_score:g,youtube_score:y,news_score:n,source_count:sourceCount,cross_source_bonus:bonus,trend_score:trendScore,...cluster};delete p.parent_key;delete p.parent_label;
 const rows=await rest("trend_topics?on_conflict=topic_key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(p)});
 return rows[0]
}
async function obs(id:number,source:string,rank:number,score:number,metric:number|null,name:string,url:string,raw:any){await rest("trend_observations",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({topic_id:id,source,source_score:score,rank,metric_value:metric,metric_name:name,url,raw_data:raw})})}
async function run(source:string,fn:()=>Promise<number>){let id:number|undefined;try{const r=await rest("collector_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({source,status:"running"})});id=r[0].id;const c=await fn();await rest(`collector_runs?id=eq.${id}`,{method:"PATCH",body:JSON.stringify({status:"success",finished_at:new Date().toISOString(),items_fetched:c})});return{source,status:"success",count:c}}catch(e){if(id)await rest(`collector_runs?id=eq.${id}`,{method:"PATCH",body:JSON.stringify({status:"error",finished_at:new Date().toISOString(),error_message:String(e)})}).catch(()=>{});return{source,status:"error",count:0,error:String(e)}}}
async function trends(){const r=await fetch("https://trends.google.com/trending/rss?geo=JP");if(!r.ok)throw new Error(`Trends ${r.status}`);const a=items(await r.text()).slice(0,100);let c=0;for(let i=0;i<a.length;i++){const title=tag(a[i],"title");if(!title)continue;const traffic=tag(a[i],"ht:approx_traffic")||tag(a[i],"approx_traffic");const score=Math.max(40,100-i*2);const t=await topic(title,"google",score,{traffic});await obs(t.id,"google",i+1,score,num(traffic),"search_volume","https://trends.google.com/trending?geo=JP",{traffic});c++}return c}
async function news(){const r=await fetch("https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja");if(!r.ok)throw new Error(`News ${r.status}`);const a=items(await r.text()).slice(0,100);let c=0;for(let i=0;i<a.length;i++){const title=tag(a[i],"title");if(!title)continue;const link=tag(a[i],"link"),publisher=tag(a[i],"source"),pubDate=tag(a[i],"pubDate");const score=Math.max(30,80-i);const t=await topic(title,"news",score,{publisher,pubDate});await obs(t.id,"news",i+1,score,null,"article_rank",link,{publisher,pubDate});c++}return c}
async function youtube(){if(!YOUTUBE_API_KEY)throw new Error("YOUTUBE_API_KEY unavailable");const u=new URL("https://www.googleapis.com/youtube/v3/videos");u.searchParams.set("part","snippet,statistics");u.searchParams.set("chart","mostPopular");u.searchParams.set("regionCode","JP");u.searchParams.set("maxResults","50");u.searchParams.set("key",YOUTUBE_API_KEY);const r=await fetch(u);if(!r.ok)throw new Error(`YouTube ${r.status} ${await r.text()}`);const data=await r.json();const a=Array.isArray(data.items)?data.items:[];let c=0;for(let i=0;i<a.length;i++){const v=a[i],title=v?.snippet?.title;if(!title)continue;const views=Number(v?.statistics?.viewCount||0)||null;const score=Math.max(40,100-i*2);const url=`https://www.youtube.com/watch?v=${v.id}`;const meta={videoId:v.id,channelTitle:v?.snippet?.channelTitle||"",publishedAt:v?.snippet?.publishedAt||"",views,likes:Number(v?.statistics?.likeCount||0)||null};const t=await topic(title,"youtube",score,meta);await obs(t.id,"youtube",i+1,score,views,"view_count",url,meta);c++}return c}
async function rescore(){
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const [rows,obsRows]=await Promise.all([
  rest("trend_topics?select=id,title,cluster_key,cluster_label,google_score,youtube_score,news_score",{method:"GET"}),
  rest(`trend_observations?select=topic_id,source,source_score,url,raw_data,observed_at&observed_at=gte.${encodeURIComponent(cutoff)}`,{method:"GET"})
 ]);
 const groups=new Map<string,any[]>(),obsByTopic=new Map<number,any[]>();
 for(const row of rows||[]){const k=row.cluster_key||("topic:"+row.id);const a=groups.get(k)||[];a.push(row);groups.set(k,a)}
 for(const o of obsRows||[]){const a=obsByTopic.get(Number(o.topic_id))||[];a.push(o);obsByTopic.set(Number(o.topic_id),a)}
 let c=0;
 for(const [k,members] of groups){
  // Rebuild current source strength strictly from observations inside the 24h window.
  // Do not use retained topic-level source scores here, because those can outlive the dashboard window.
  const clusterObs=members.flatMap(r=>obsByTopic.get(Number(r.id))||[]);
  const sourceMax=(name:string)=>Math.max(0,...clusterObs.filter((o:any)=>o.source===name).map((o:any)=>Number(o.source_score||0)));
  const g=sourceMax("google");
  const y=sourceMax("youtube");
  const n=sourceMax("news");
  const sourceCount=[g,y,n].filter(v=>v>0).length;
  const crossSourceBonus=sourceCount>=3?20:sourceCount===2?10:0;

  // News breadth: many independent outlets covering the same subject is itself a strong TREND signal.
  // Count unique publishers and unique article URLs in the last 24h; duplicates from hourly collection do not inflate it.
  const newsObs=members.flatMap(r=>obsByTopic.get(Number(r.id))||[]).filter((o:any)=>o.source==="news");
  const newsUrls=new Set(newsObs.map((o:any)=>String(o.url||"").trim()).filter(Boolean));
  const newsPublishers=new Set(newsObs.map((o:any)=>String(o.raw_data?.publisher||"").normalize("NFKC").toLowerCase().trim()).filter(Boolean));
  const newsCoverageBonus=Math.min(40,Math.round((newsPublishers.size*3 + Math.log2(Math.max(1,newsUrls.size))*3)*100)/100);

  const score=Math.min(100,Math.round((g*.4+y*.3+n*.3+crossSourceBonus+newsCoverageBonus)*100)/100);
  const [prev,history]=await Promise.all([
   rest(`trend_cluster_snapshots?cluster_key=eq.${encodeURIComponent(k)}&observed_at=lte.${encodeURIComponent(new Date(Date.now()-45*60*1000).toISOString())}&select=trend_score,google_score,youtube_score,news_score,source_count,observed_at&order=observed_at.desc&limit=1`,{method:"GET"}),
   rest(`trend_cluster_snapshots?cluster_key=eq.${encodeURIComponent(k)}&select=id,observed_at&order=observed_at.desc&limit=2`,{method:"GET"})
  ]);
  const p=prev?.[0],historyCount=Array.isArray(history)?history.length:0;
  const velocity=p?Math.round((score-Number(p.trend_score||0))*100)/100:0;
  const pg=p?Number(p.google_score||0):0,py=p?Number(p.youtube_score||0):0,pn=p?Number(p.news_score||0):0,pc=p?Number(p.source_count||0):0;
  const newSources:string[]=[];if(g>0&&pg<=0)newSources.push("Google");if(n>0&&pn<=0)newSources.push("News");if(y>0&&py<=0)newSources.push("YouTube");
  const propagationParts:string[]=[];
  if(newSources.length)propagationParts.push(pc>0?`+${newSources.join("+")}`:`First:${newSources.join("+")}`);
  if(newsPublishers.size>=3)propagationParts.push(`News ${newsPublishers.size}媒体`);
  const propagation=propagationParts.length?propagationParts.join(" / "):null;
  // EARLY measures acceleration / propagation, not current popularity.
  // News coverage affects current TREND only; it does not directly inflate EARLY.
  const positiveVelocity=Math.max(0,velocity);
  const sourceGain=Math.max(0,sourceCount-pc);
  const propagationBonus=newSources.length>0&&pc>0?10:0;
  const rawEarly=Math.min(100,Math.max(0,Math.round((positiveVelocity*2 + sourceGain*25 + propagationBonus)*100)/100));
  // Fresh clusters need a short warm-up so a newly split/created cluster is not mistaken for genuine acceleration.
  // 1st observation: no EARLY signal. 2nd observation: WATCH at most. 3rd+ observations: normal thresholds.
  const early=historyCount===0?0:historyCount===1?Math.min(rawEarly,20):rawEarly;
  const level=early>=70?"hot":early>=45?"rising":early>=20?"watch":"none";
  const labelCounts=new Map<string,number>();
  for(const m of members){const l=String(m.cluster_label||"").trim();if(l)labelCounts.set(l,(labelCounts.get(l)||0)+1)}
  const snapshotLabel=[...labelCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"ja"))[0]?.[0]||k;
  await rest("trend_cluster_snapshots",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({cluster_key:k,cluster_label:snapshotLabel,trend_score:score,google_score:g,youtube_score:y,news_score:n,source_count:sourceCount})});
  for(const row of members){await rest(`trend_topics?id=eq.${row.id}`,{method:"PATCH",body:JSON.stringify({cluster_google_score:g,cluster_youtube_score:y,cluster_news_score:n,cluster_source_count:sourceCount,cluster_trend_score:score,velocity_1h:velocity,early_signal_score:early,early_signal_level:level,propagation_path:propagation})});c++}
 }
 return c
}

const RELEVANCE_WINDOW_HOURS=24;
function relNorm(s:string){return (s||"").normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim()}
function relHas(text:string,term:string){
 const x=relNorm(text),t=relNorm(term);if(!t)return false;
 if(t.length===1)return x===t;
 let from=0;
 while(true){
  const i=x.indexOf(t,from);if(i<0)return false;
  const before=i>0?x[i-1]:"",after=i+t.length<x.length?x[i+t.length]:"";
  const ascii=/[a-z0-9]/i,katakana=/[ァ-ヶー]/;
  const asciiTerm=/^[a-z0-9.+#-]+$/i.test(t),katakanaTerm=/^[ァ-ヶー]+$/.test(t);
  if(asciiTerm){
   if(!ascii.test(before)&&!ascii.test(after))return true;
  }else if(katakanaTerm){
   if(!ascii.test(before)&&!ascii.test(after)&&!katakana.test(before)&&!katakana.test(after))return true;
  }else{
   if(!ascii.test(before)&&!ascii.test(after))return true;
  }
  from=i+1;
 }
}
function uniq<T>(a:T[]){return [...new Set(a)]}
function pruneMatches(a:string[]){
 const sorted=uniq(a).sort((x,y)=>relNorm(y).length-relNorm(x).length);
 const kept:string[]=[];
 for(const term of sorted){
  const n=relNorm(term);
  if(!kept.some(k=>relNorm(k).includes(n)))kept.push(term);
 }
 return kept;
}
function levelFromScore(score:number){return score>=80?"high":score>=60?"medium":score>=40?"low":"none"}
function evalRelevance(text:string,rules:any[],entities:any[],excludes:any[]){
 const by=new Map<string,any>();
 function put(domain:string,category:string,score:number,ruleIds:number[]=[],terms:string[]=[],entityIds:number[]=[]){
  if(!category||score<=0)return;
  const k=domain+"|"+category,old=by.get(k)||{relevance_domain:domain,category_key:category,relevance_score:0,matched_rule_ids:[],matched_terms:[],matched_entity_ids:[]};
  old.relevance_score=Math.max(old.relevance_score,score);
  old.matched_rule_ids=uniq([...old.matched_rule_ids,...ruleIds]);
  old.matched_terms=uniq([...old.matched_terms,...terms]);
  old.matched_entity_ids=uniq([...old.matched_entity_ids,...entityIds]);
  by.set(k,old);
 }
 for(const e of entities||[]){
  if(e.enabled!==false&&relHas(text,e.entity_value))put(e.relevance_domain,e.category_key,100,[],[e.entity_value],[e.id]);
 }
 for(const r of rules||[]){
  if(r.enabled===false||!r.category_key)continue;
  const blocked=(excludes||[]).some((e:any)=>e.enabled!==false&&e.relevance_domain===r.relevance_domain&&e.category_key===r.category_key&&(e.match_terms||[]).some((t:string)=>relHas(text,t)));
  if(blocked)continue;
  const matches=pruneMatches((r.match_terms||[]).filter((t:string)=>relHas(text,t)));
  const strongNorm=new Set((r.strong_terms||[]).map((t:string)=>relNorm(t)));
  const strong=matches.filter((t:string)=>strongNorm.has(relNorm(t)));
  let score=0;
  if(strong.length>=2)score=85;
  else if(matches.length>=2)score=65;
  else if(matches.length===1)score=40;
  if(score>0)put(r.relevance_domain,r.category_key,score,[r.id],matches,[]);
 }
 return [...by.values()].map(x=>({...x,relevance_level:levelFromScore(x.relevance_score)}));
}
async function relevance(){
 const cutoff=new Date(Date.now()-RELEVANCE_WINDOW_HOURS*60*60*1000).toISOString();
 const allRules=await rest("watch_rules?select=id,rule_type,value,relevance_domain,category_key,match_terms,strong_terms,enabled&enabled=eq.true",{method:"GET"});
 const rules=(allRules||[]).filter((r:any)=>r.rule_type==="industry");
 const excludes=(allRules||[]).filter((r:any)=>r.rule_type==="exclude");
 const entities=await rest("relevance_entities?select=id,relevance_domain,category_key,entity_value,relevance_level,enabled&enabled=eq.true",{method:"GET"});
 const topics=await rest(`trend_topics?select=id,title,cluster_key,cluster_label,last_seen_at&last_seen_at=gte.${encodeURIComponent(cutoff)}&order=last_seen_at.desc`,{method:"GET"});
 await rest("relevance_results?id=gt.0",{method:"DELETE",headers:{Prefer:"return=minimal"}});
 const rows:any[]=[];
 const groups=new Map<string,any[]>();
 for(const t of topics||[]){
  const hits=evalRelevance(t.title||"",rules||[],entities||[],excludes||[]);
  for(const h of hits)rows.push({subject_type:"topic",topic_id:t.id,cluster_key:null,...h,evidence:{title:t.title,window_hours:RELEVANCE_WINDOW_HOURS},evaluated_at:new Date().toISOString()});
  if(t.cluster_key){const a=groups.get(t.cluster_key)||[];a.push(t);groups.set(t.cluster_key,a)}
 }
 for(const [clusterKey,members] of groups){
  const combined=members.map(x=>x.title||"").join("\n");
  const hits=evalRelevance(combined,rules||[],entities||[],excludes||[]);
  for(const h of hits)rows.push({subject_type:"cluster",topic_id:null,cluster_key:clusterKey,...h,evidence:{cluster_label:members[0]?.cluster_label||clusterKey,member_count:members.length,sample_titles:members.slice(0,5).map(x=>x.title),window_hours:RELEVANCE_WINDOW_HOURS},evaluated_at:new Date().toISOString()});
 }
 if(rows.length)await rest("relevance_results",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});
 return{topics:(topics||[]).length,clusters:groups.size,results:rows.length,window_hours:RELEVANCE_WINDOW_HOURS}
}


function evidenceLevel(score:number){return score>=75?"strong":score>=50?"good":score>=30?"watch":"light"}
function youtubeMomentum(vph:number){return vph>=50000?25:vph>=10000?20:vph>=3000?15:vph>=1000?10:vph>=300?5:0}
async function evidence(){
 const cutoff=new Date(Date.now()-RELEVANCE_WINDOW_HOURS*60*60*1000).toISOString();
 const [obsRows,profiles,topics]=await Promise.all([
  rest(`trend_observations?select=topic_id,source,url,raw_data,observed_at&observed_at=gte.${encodeURIComponent(cutoff)}&order=observed_at.desc`,{method:"GET"}),
  rest("source_profiles?select=source_name,source_type,base_trust,specialties,first_party,enabled&enabled=eq.true",{method:"GET"}),
  rest(`trend_topics?select=id,title,last_seen_at&last_seen_at=gte.${encodeURIComponent(cutoff)}`,{method:"GET"})
 ]);
 const profileMap=new Map((profiles||[]).map((p:any)=>[relNorm(p.source_name),p]));
 const topicMap=new Map((topics||[]).map((t:any)=>[t.id,t]));
 const byTopic=new Map<number,any[]>();
 const scoringSources=new Set(["google","news","youtube"]);
 for(const o of obsRows||[]){
  if(!topicMap.has(o.topic_id)||!scoringSources.has(o.source))continue;
  const a=byTopic.get(o.topic_id)||[];a.push(o);byTopic.set(o.topic_id,a)
 }
 const rows:any[]=[];
 const now=Date.now();
 for(const [topicId,items] of byTopic){
  const deduped=[...new Map(items.map((x:any)=>[(x.source||"")+"|"+(x.url||JSON.stringify(x.raw_data||{})),x])).values()];
  const refs:any[]=[];
  // EVIDENCE is deliberately limited to the three primary scoring channels.
  // HN / Wikipedia / Bluesky / GDELT are observation-only and never reduce or inflate this score.
  const sources=new Set(deduped.map((x:any)=>x.source).filter((s:string)=>scoringSources.has(s)));
  let googleCount=0,newsCount=0,youtubeCount=0,maxViews=0,maxVph=0;
  for(const o of deduped){
   if(o.source==="google"){googleCount++;continue}
   if(o.source==="news"){
    newsCount++;
    const publisher=String(o.raw_data?.publisher||"").trim();
    const p=profileMap.get(relNorm(publisher));
    const trust=Number(p?.base_trust||60);
    refs.push({type:"news",label:publisher||"News",url:o.url,published_at:o.raw_data?.pubDate||o.observed_at,trust,source_type:p?.source_type||"news"});
   }else if(o.source==="youtube"){
    youtubeCount++;
    const views=Number(o.raw_data?.views||0),likes=Number(o.raw_data?.likes||0),publishedAt=o.raw_data?.publishedAt||o.observed_at;
    const ageHours=Math.max(1,(now-new Date(publishedAt).getTime())/3600000);
    const vph=Math.round(views/ageHours);
    maxViews=Math.max(maxViews,views);maxVph=Math.max(maxVph,vph);
    refs.push({type:"youtube",label:o.raw_data?.channelTitle||"YouTube",url:o.url,published_at:publishedAt,trust:45,views,likes,views_per_hour:vph,source_type:"video"});
   }
  }
  const trusted=refs.map(x=>Number(x.trust||0)).sort((a,b)=>b-a).slice(0,3);
  const trustScore=trusted.length?Math.round(trusted.reduce((a,b)=>a+b,0)/trusted.length):0;
  const sourceCount=sources.size;
  const cross=sourceCount>=3?50:sourceCount===2?30:sourceCount===1?10:0;
  const score=Math.min(100,cross+Math.min(25,newsCount*5)+youtubeMomentum(maxVph));
  const rankedNews=refs.filter(x=>x.type==="news").sort((a,b)=>b.trust-a.trust||String(b.published_at).localeCompare(String(a.published_at))).slice(0,5);
  const rankedYoutube=refs.filter(x=>x.type==="youtube").sort((a,b)=>b.views_per_hour-a.views_per_hour).slice(0,3);
  rows.push({
   topic_id:topicId,
   source_trust_score:trustScore,
   evidence_score:score,
   evidence_level:evidenceLevel(score),
   source_count:sourceCount,
   google_count:googleCount,
   news_count:newsCount,
   youtube_count:youtubeCount,
   youtube_max_views:maxViews||null,
   youtube_max_views_per_hour:maxVph||null,
   reference_items:[...rankedNews,...rankedYoutube],
   evaluated_at:new Date().toISOString()
  });
 }
 if(rows.length)await rest("topic_evidence?on_conflict=topic_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
 return{topics:rows.length}
}


const CRON_TOKEN_SHA256="effaf6f60c8e45cc921f5a4137a9483e78432fbfe7e2df99d485fb79230d483d";
async function authorizedCronRequest(req:Request){
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return false;
  const token=auth.slice(7).trim();
  if(!token)return false;
  const bytes=new TextEncoder().encode(token);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return hex===CRON_TOKEN_SHA256;
}

Deno.serve(async req=>{if(req.method!=="POST")return new Response("POST only",{status:405});if(!(await authorizedCronRequest(req)))return new Response("Forbidden",{status:403});const results=[await run("google",trends),await run("news",news),await run("youtube",youtube)];const rescored=await rescore();let evidenceResult:any;try{const e=await evidence();evidenceResult={status:"success",...e};}catch(e){evidenceResult={status:"error",error:String(e)};}let relevanceResult:any;try{const r=await relevance();relevanceResult={status:"success",...r};await rest("collector_runs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({source:"relevance",status:"success",finished_at:new Date().toISOString(),items_fetched:r.results,metadata:{window_hours:r.window_hours,topics:r.topics,clusters:r.clusters}})});}catch(e){relevanceResult={status:"error",error:String(e)};await rest("collector_runs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({source:"relevance",status:"error",finished_at:new Date().toISOString(),items_fetched:0,error_message:String(e),metadata:{window_hours:RELEVANCE_WINDOW_HOURS}})}).catch(()=>{});}return Response.json({ok:results.some(x=>x.status==="success"),results,rescored,evidence:evidenceResult,relevance:relevanceResult,at:new Date().toISOString()})});
