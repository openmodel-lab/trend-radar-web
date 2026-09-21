export type ClusterCandidate = {
  id?: number;
  title: string;
  cluster_key?: string | null;
  cluster_label?: string | null;
};

export type ClusterResult = {
  cluster_key: string;
  cluster_label: string;
  cluster_method: string;
  cluster_confidence: number;
  parent_key?: string;
  parent_label?: string;
};

export type ExistingClusterState = {
  cluster_key?: string | null;
  cluster_label?: string | null;
  cluster_method?: string | null;
  cluster_confidence?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type EventDefinition = {
  key: string;
  label: string;
  required: readonly (readonly string[])[];
  aliases?: readonly string[];
  parent_key?: string;
  parent_label?: string;
};

export const ALIASES: [RegExp, string][] = [
  [/ユニバーサル[・･\s]*スタジオ[・･\s]*ジャパン|universal studios japan|\busj\b/gi, "usj"],
  [/東京[・･\s]*ディズニー(ランド|リゾート|シー)|tokyo disney(resort|land|sea)?/gi, "東京ディズニー"],
  [/大阪[・･\s]*関西万博|関西万博|大阪万博|expo\s*2025/gi, "大阪関西万博"],
  [/東京ゲームショウ\s*2026|東京ゲームショウ|\btgs\s*2026\b/gi, "東京ゲームショウ2026"],
  [/東京ガールズコレクション\s*2026|東京ガールズコレクション|\btgc\s*2026\b/gi, "東京ガールズコレクション2026"],
];

export const STOP = new Set([
  "速報", "動画", "公式", "最新", "ニュース", "news", "live", "ライブ", "について", "まとめ", "発表",
  "日本", "japan", "the", "and", "今日", "独自", "映画", "予告", "new", "be", "group", "時代",
  "複数視点", "video", "music", "performance", "映像", "最強", "ガチ", "更新", "位置", "チケット",
  "スマホ", "アニメ",
]);

export const ENTITY_ALIASES: [RegExp, string][] = [
  [/台風\s*25号|typhoon(?:\s+japan)?/gi, "台風25号"],
  [/グリーンランド/gi, "グリーンランド"],
  [/日銀|日本銀行/gi, "日銀"],
  [/モンスターストライク|モンスト/gi, "モンスト"],
  [/ウマ娘(?:\s*プリティーダービー)?/gi, "ウマ娘"],
  [/進撃の巨人|attack on titan/gi, "進撃の巨人"],
  [/藤井\s*風|fujii\s*kaze/gi, "藤井風"],
  [/櫻坂\s*46|櫻坂46|櫻坂/gi, "櫻坂46"],
  [/日向坂\s*46|日向坂46|日向坂/gi, "日向坂46"],
  [/le\s*sserafim|르세라핌/gi, "le sserafim"],
  [/aぇ!?\s*group/gi, "aぇ! group"],
  [/six\s*tones/gi, "sixtones"],
  [/bts/gi, "bts"],
  [/大谷翔平|大谷/gi, "大谷翔平"],
  [/山本由伸|ヨシノブ/gi, "山本由伸"],
  [/高市(?:首相|総理|早苗)?/gi, "高市早苗"],
  [/トランプ(?:氏|大統領|政権)?/gi, "トランプ"],
  [/プーチン(?:氏|大統領|政権)?/gi, "プーチン"],
  [/愛知[・･\s]*名古屋アジア大会|名古屋アジア大会|アジア競技大会|アジア大会/gi, "愛知名古屋アジア大会"],
  [/若林有子(?:アナウンサー|アナ)?/gi, "若林有子"],
  [/be[:：\s-]*first/gi, "be:first"],
  [/niziu|니쥬/gi, "niziu"],
  [/snow\s*man/gi, "snow man"],
  [/efootball|イーフットボール|イーフト/gi, "efootball"],
  [/マインクラフト|マイクラ|まいくら/gi, "マインクラフト"],
  [/apple\s*watch\s*ultra/gi, "apple watch ultra"],
  [/ultra\s*japan/gi, "ultra japan"],
  [/新\s*美味しんぼ/gi, "新 美味しんぼ"],
  [/クレヨンしんちゃん/gi, "クレヨンしんちゃん"],
  [/bleach/gi, "bleach"],
  [/名探偵プリキュア/gi, "名探偵プリキュア"],
  [/新日本プロレス/gi, "新日本プロレス"],
  [/中田(?:カウス[・･\s]*ボタンの)?ボタン|中田ボタン/gi, "中田ボタン"],
  [/オールカマー/gi, "オールカマー"],
  [/踊る大捜査線/gi, "踊る大捜査線"],
  [/#?surge\s*town/gi, "surge town"],
];

export function clusterText(s: string) {
  let x = String(s || "").normalize("NFKC").toLowerCase();
  for (const [re, to] of ALIASES) x = x.replace(re, to);
  for (const [re, to] of ENTITY_ALIASES) x = x.replace(re, to);
  return x.replace(/[【】\[\]（）()「」『』〈〉《》:：!！?？,，.。\-_/|｜]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Manually approved, stable identities used only as an additional eligibility
// signal. A key in this set must still pass semanticKeyMatches() for the
// incoming title before an existing cluster can be inherited.
export const APPROVED_IDENTITY_KEYS = new Set([
  "ガチ夢中", "きゅるりんってしてみて", "佐々木彩乃", "森崎ウィン", "神谷そら", "八つ墓村",
  "starto", "いきものがかり", "ジダン", "セウタ", "テスラ", "ドイツ", "トヨタ", "ドル円",
  "マルイ", "ロシア", "ロシア下院選", "綾瀬はるかさん", "宇賀なつみ", "横浜市", "岡崎市", "科捜研の女",
  "外山斎", "外務省", "希良梨", "貴景勝", "鬼連チャン", "宮崎県", "京極町", "競馬ラボ", "玉ノ井親方",
  "金近廉", "源治麿", "虎テレ", "資さんうどん", "小栗旬", "小糸川", "小田ときと", "常磐線", "新幹線",
  "西田たかのり", "青森市", "千葉市", "大橋信", "大島町", "大友愛", "池上彰", "鳥谷敬", "天草灘",
  "田中碧", "唐田えりか", "藤ノ川", "二階堂ふみ", "武井壮", "福澤朗", "平野レミ", "北朝鮮",
  "遊戯王", "태풍 두쥐안", "超特急", "朝乃山",
].map(clusterText));

export function compactNormalized(s: string) {
  return clusterText(s).replace(/[\s・･·:：_\-‐‑‒–—―/／|｜.。]+/g, "");
}

export function tokens(s: string) {
  const a = clusterText(s).match(/[a-z0-9]{2,}|[ァ-ヶー]{2,}|[一-龯]{2,}/g) || [];
  return [...new Set(a.filter((v) => !STOP.has(v)))].slice(0, 12);
}

function tokenNear(a: string, b: string) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length), max = Math.max(a.length, b.length);
  if (min < 5 || min / max < .8) return false;
  return a.includes(b) || b.includes(a);
}

export function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  let hit = 0;
  for (const x of A) if (B.some((y) => tokenNear(x, y))) hit++;
  return hit / Math.max(A.length, B.length);
}

export function canonical(s: string) {
  const raw = String(s || "").normalize("NFKC").trim();
  const series = raw.match(/^『([^』]{2,40})』(?:第\s*\d+\s*回|\s)/);
  if (series) return series[1].trim().slice(0, 80);
  const stripped = raw.replace(/^【[^】]{1,40}】\s*/, "").replace(
    /\s+-\s+(?:Gizmodo|Yahoo!?ニュース|news\.yahoo\.co\.jp|オリコンニュース|ORICON NEWS|日本経済新聞|朝日新聞|読売新聞|産経ニュース|時事ドットコム|毎日新聞)\s*$/i,
    "",
  );
  const x = clusterText(stripped);
  for (const [, to] of [...ALIASES, ...ENTITY_ALIASES]) if (x.includes(to)) return to;
  const a = x.match(/[a-z0-9]{2,}|[一-龯ぁ-んァ-ヶー]{2,}/g) || [];
  const t = [...new Set(a.filter((v) => !STOP.has(v) && !/^\d+$/.test(v)))];
  return (t[0] || x).slice(0, 80);
}

const ANCHOR_STOP = new Set([
  "活動休止", "傷害容疑", "逮捕報道", "正式処分", "事実関係", "所属事務", "所属事務所", "女性への",
  "被害女性", "警視庁", "お知らせ", "朝日新聞", "読売新聞", "産経ニュース", "時事通信", "共同通信",
  "毎日新聞", "スポニチ", "ニュース", "news", "yahoo", "starto", "sponichi", "annex",
]);

export function anchors(s: string) {
  const x = String(s || "").normalize("NFKC").toLowerCase(), out = new Set<string>();
  for (const m of x.matchAll(/[a-z][a-z0-9.+#-]{3,}/g)) {
    const v = m[0];
    if (!STOP.has(v) && !ANCHOR_STOP.has(v)) out.add(v);
  }
  for (const m of x.matchAll(/[ァ-ヶー]{4,}/g)) {
    const v = m[0];
    if (!ANCHOR_STOP.has(v)) out.add(v);
  }
  for (const m of x.matchAll(/[一-龯]{4,}/g)) {
    const run = m[0];
    for (let n = Math.min(6, run.length); n >= 4; n--) {
      for (let i = 0; i + n <= run.length; i++) {
        const v = run.slice(i, i + n);
        if (!ANCHOR_STOP.has(v) && ![...ANCHOR_STOP].some((z) => v.includes(z) || z.includes(v))) out.add(v);
      }
    }
  }
  return [...out].slice(0, 48);
}

function sharedAnchors(a: string, b: string) {
  const A = anchors(a), B = new Set(anchors(b));
  return A.filter((x) => B.has(x)).sort((x, y) => y.length - x.length);
}

export function anchorSimilarity(a: string, b: string) {
  const shared = sharedAnchors(a, b);
  const cjk = shared.filter((x) => /^[一-龯]+$/.test(x));
  const latin = shared.filter((x) => /^[a-z]/.test(x));
  if (cjk.some((x) => x.length >= 5) && latin.length) return .98;
  if (cjk.some((x) => x.length >= 4) && latin.length) return .95;
  if (cjk.some((x) => x.length >= 6)) return .92;
  if (cjk.filter((x) => x.length >= 4).length >= 2) return .88;
  if (cjk.some((x) => x.length >= 4)) return .76;
  if (latin.length >= 2) return .72;
  return 0;
}

export function anchorLabel(a: string, b: string) {
  const shared = sharedAnchors(a, b);
  const cjk = shared.find((x) => /^[一-龯]+$/.test(x) && x.length >= 4);
  const latin = shared.find((x) => /^[a-z]/.test(x));
  if (latin && cjk) return `${latin} ${cjk}`.slice(0, 80);
  if (cjk) return cjk.slice(0, 80);
  if (latin) return latin.slice(0, 80);
  return "";
}

export const GENERIC_CLUSTER = new Set([
  "ゲーム", "動画", "ニュース", "ライブ", "映画", "音楽", "テレビ", "公式", "最新", "アニメ", "映像",
  "最強", "ガチ", "独自", "更新", "位置", "スマホ", "チケット",
]);

export function genericKey(c: string) {
  const x = String(c || "").trim().toLowerCase();
  return GENERIC_CLUSTER.has(x) || (/^[a-z0-9]+$/i.test(x) && x.length <= 3) ||
    (/^[一-龯ぁ-んァ-ヶー]+$/.test(x) && x.length <= 2);
}

export const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  { key: "event:trump_greenland", label: "トランプ × グリーンランド", required: [["グリーンランド"], ["トランプ", "デンマーク", "アメリカ", "米国"]], parent_key: "entity:trump", parent_label: "トランプ" },
  { key: "event:trump_media_access", label: "トランプ × メディア取材制限", required: [["トランプ", "ホワイトハウス"], ["cnn", "取材禁止", "記者証", "締め出", "排除", "立ち入り拒否"]], parent_key: "entity:trump", parent_label: "トランプ" },
  { key: "event:trump_us_china", label: "トランプ × 米中首脳会談", required: [["トランプ"], ["習近平", "習氏", "米中", "晩さん会", "訪米", "歓迎式典", "国賓"]], parent_key: "entity:trump", parent_label: "トランプ" },
  { key: "event:trump_russia_ukraine", label: "トランプ × ロシア・ウクライナ", required: [["トランプ"], ["ロシア", "ウクライナ", "対露", "和平", "制裁"]], parent_key: "entity:trump", parent_label: "トランプ" },
  { key: "event:trump_ai_force", label: "トランプ「AIフォース」", required: [["トランプ"], ["aiフォース", "ai フォース", "ai軍"]], parent_key: "entity:trump", parent_label: "トランプ" },
  { key: "event:takaichi_cabinet", label: "高市政権 人事・内閣改造", required: [["高市"], ["人事", "内閣改造", "副大臣", "政務官", "閣内", "国対", "役職"]], parent_key: "entity:takaichi", parent_label: "高市早苗" },
  { key: "event:takaichi_approval", label: "高市内閣 支持率", required: [["高市"], ["支持率"]], parent_key: "entity:takaichi", parent_label: "高市早苗" },
  { key: "event:takaichi_boj_fiscal", label: "高市財政 × 日銀・市場", required: [["高市"], ["日銀", "利上げ", "財政", "市場", "金利"]], parent_key: "entity:takaichi", parent_label: "高市早苗" },
  { key: "event:takaichi_other", label: "高市早苗 その他の動き", required: [["高市"]], parent_key: "entity:takaichi", parent_label: "高市早苗" },
  { key: "event:xi_health_rumor", label: "習近平の体調不良説", required: [["習近平"], ["体調不良", "倒れ", "意識消失", "脳梗塞", "救急搬送", "所在不明"]], parent_key: "entity:習近平", parent_label: "習近平" },
  { key: "event:iphone_duo_foldable", label: "iPhone Duo・折り畳みiPhone", required: [["iphone", "アップル"], ["iphone duo", "折り畳み", "折りたたみ", "フォルダブル", "fold"]], parent_key: "entity:iphone", parent_label: "iPhone" },
  { key: "event:iphone18_pro", label: "iPhone 18 Pro", required: [["iphone"], ["18 pro", "iphone18 pro"]], parent_key: "entity:iphone", parent_label: "iPhone" },
  { key: "event:gta6_miami_vice_city", label: "GTA6 × マイアミ「バイスシティ」計画", required: [["gta6", "gta 6"], ["マイアミ", "miami", "バイスシティ", "vice city"]] },
  { key: "event:saitama-hanyu-shotgun-theft-20260919", label: "埼玉・羽生で散弾銃3丁と実包125発盗難", required: [["埼玉", "羽生"], ["散弾銃", "実包", "実弾", "ショットガン"], ["盗", "空き巣"]] },
  { key: "event:semiconductor_capacity", label: "半導体 生産能力", required: [["半導体"], ["生産能力", "capacity", "最大産地"]] },
  { key: "event:オールカマー", label: "オールカマー", required: [["オールカマー"]] },
  { key: "event:パンサー向井若林有子熱愛", label: "パンサー向井 × 若林有子", required: [["パンサー", "向井"], ["若林有子", "熱愛", "交際"]] },
  { key: "event:沖縄知事選古謝氏爆破予告", label: "沖縄知事選 古謝氏への爆破予告", required: [["古謝"], ["爆破", "殺害予告", "脅迫"]] },
  { key: "event:宮城塩釜熊", label: "宮城・塩釜 熊", required: [["塩釜"], ["熊"]] },
];

const EVENT_BY_KEY = new Map(EVENT_DEFINITIONS.map((definition) => [definition.key, definition]));
const ALIAS_TARGETS = new Set([...ALIASES, ...ENTITY_ALIASES].map(([, value]) => clusterText(value)));

function containsSemanticTerm(title: string, term: string) {
  return clusterText(title).includes(clusterText(term));
}

export function matchesEventDefinition(title: string, key: string) {
  const definition = EVENT_BY_KEY.get(key);
  if (!definition) return false;
  return definition.required.every((group) => group.some((term) => containsSemanticTerm(title, term)));
}

export function priorityEventCluster(title: string) {
  const x = title.normalize("NFKC").toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => x.includes(term.toLowerCase()));
  let key = "";
  if (has("トランプ")) {
    if (has("グリーンランド", "デンマーク")) key = "event:trump_greenland";
    else if (has("cnn", "ホワイトハウス", "取材禁止", "記者証", "締め出", "排除")) key = "event:trump_media_access";
    else if (has("習近平", "習氏", "米中", "晩さん会", "訪米", "歓迎式典", "国賓")) key = "event:trump_us_china";
    else if (has("ロシア", "ウクライナ", "対露", "和平", "制裁法")) key = "event:trump_russia_ukraine";
    else if (has("aiフォース", "ai フォース")) key = "event:trump_ai_force";
  }
  if (!key && has("高市")) {
    if (has("人事", "改造内閣", "副大臣", "政務官", "国対", "役職希望", "閣内")) key = "event:takaichi_cabinet";
    else if (has("支持率")) key = "event:takaichi_approval";
    else if (has("利上げ", "日銀", "財政", "市場", "金利")) key = "event:takaichi_boj_fiscal";
    else key = "event:takaichi_other";
  }
  if (!key && has("習近平") && has("体調不良", "倒れた", "意識消失", "脳梗塞", "救急搬送", "所在不明")) key = "event:xi_health_rumor";
  if (!key && has("iphone")) {
    if (has("iphone duo", "折り畳み", "折りたたみ", "フォルダブル", "fold")) key = "event:iphone_duo_foldable";
    else if (has("iphone 18 pro", "iphone18 pro", "18 pro／pro max", "18 pro/pro max")) key = "event:iphone18_pro";
  }
  return key ? EVENT_BY_KEY.get(key) || null : null;
}

function keyVariants(key: string) {
  const suffix = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  return [...new Set([suffix, suffix.replace(/_/g, " "), suffix.replace(/_/g, ":"), key])].filter(Boolean);
}

function semanticPhraseEligible(value: string) {
  const normalized = clusterText(value), compact = compactNormalized(value);
  if (!normalized || !compact || /^\d+$/.test(compact) || STOP.has(normalized)) return false;
  if (ALIAS_TARGETS.has(normalized)) return true;
  if (genericKey(normalized)) return false;
  if (/^[一-龯ぁ-んァ-ヶー]+$/.test(compact)) return compact.length >= 3;
  if (/^[a-z0-9]+$/i.test(compact)) return compact.length >= 4;
  return compact.length >= 3;
}

export function semanticKeyEligible(key: string) {
  if (!key || /^topic:\d+$/i.test(key)) return false;
  if (key.startsWith("event:")) return EVENT_BY_KEY.has(key);
  if (key.includes(":") && !/^(entity|series):/.test(key)) return false;

  const suffix = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  const meaning = clusterText(suffix.replace(/_/g, " "));
  const compact = compactNormalized(meaning);
  if (!semanticPhraseEligible(meaning)) return false;
  if (APPROVED_IDENTITY_KEYS.has(meaning)) return true;
  if (ALIAS_TARGETS.has(meaning)) return true;

  // Eligibility is derived only from the key itself. Unknown short/common terms
  // have no independent identity signal and therefore remain legacy/UNKNOWN.
  const identityAnchors = anchors(meaning);
  const mixedScript = /[a-z0-9]/i.test(compact) && /[一-龯ぁ-んァ-ヶー]/.test(compact);
  return identityAnchors.length > 0 || mixedScript;
}

function asymmetricContains(title: string, phrase: string) {
  const titleText = clusterText(title), keyText = clusterText(phrase);
  if (/^[a-z0-9 ]+$/i.test(keyText)) {
    const escaped = keyText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(titleText);
  }
  return titleText.includes(keyText);
}

export function semanticKeyMatches(title: string, key: string) {
  if (!key || /^topic:\d+$/i.test(key)) return false;
  if (key.startsWith("event:")) return matchesEventDefinition(title, key);
  const phrases = new Set<string>();
  for (const variant of keyVariants(key)) {
    phrases.add(clusterText(variant));
    phrases.add(clusterText(canonical(variant)));
  }
  const titleCanonical = clusterText(canonical(title));
  const titleCompact = compactNormalized(title);
  for (const phrase of [...phrases].filter(semanticPhraseEligible)) {
    if (titleCanonical === phrase || asymmetricContains(title, phrase)) return true;
    const compact = compactNormalized(phrase);
    if (compact.length >= 3 && titleCompact.includes(compact)) return true;
  }
  return false;
}

export function reproducibleClusterKeys(candidates: readonly ClusterCandidate[]) {
  const result = new Set<string>();
  for (const candidate of candidates) {
    const key = String(candidate.cluster_key || "");
    if (semanticKeyEligible(key)) result.add(key);
  }
  return result;
}

export function selectCluster(title: string, candidates: readonly ClusterCandidate[]): ClusterResult {
  const forced = priorityEventCluster(title);
  if (forced) {
    return {
      cluster_key: forced.key,
      cluster_label: forced.label,
      cluster_method: "event_child_v01",
      cluster_confidence: 1,
      parent_key: forced.parent_key,
      parent_label: forced.parent_label,
    };
  }
  const c = canonical(title), reproducible = reproducibleClusterKeys(candidates);
  let best: ClusterCandidate | null = null, bestScore = 0, bestAnchor = 0;
  for (const candidate of candidates) {
    const key = String(candidate.cluster_key || "");
    if (!key || !reproducible.has(key) || !semanticKeyMatches(title, key)) continue;
    const rc = canonical(candidate.title), aScore = anchorSimilarity(title, candidate.title);
    const cGeneric = genericKey(c), rcGeneric = genericKey(rc);
    const sim = similarity(title, candidate.title);
    // Passing the semantic key gate is sufficient for bootstrap; member similarity
    // only ranks/confirms candidates after the gate and can never revive a rejection.
    let score = Math.max(.85, !cGeneric && !rcGeneric && (key === c || rc === c) ? 1 : sim);
    if (!cGeneric && c.length >= 4 && clusterText(candidate.title).includes(c)) score = Math.max(score, .85);
    if (!rcGeneric && rc.length >= 4 && clusterText(title).includes(rc)) score = Math.max(score, .85);
    if (cGeneric || rcGeneric) score = Math.max(score, aScore, sim >= .75 ? sim : 0);
    score = Math.max(score, aScore);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestAnchor = aScore;
    }
  }
  if (best && bestScore >= .45) {
    const key = String(best.cluster_key || "");
    const definition = EVENT_BY_KEY.get(key);
    const stableLabel = /^(series|entity|event):/.test(key);
    const label = definition?.label || (stableLabel
      ? best.cluster_label || canonical(best.title)
      : bestAnchor >= .72
      ? anchorLabel(title, best.title) || best.cluster_label || canonical(best.title)
      : best.cluster_label || canonical(best.title));
    return {
      cluster_key: key || canonical(best.title),
      cluster_label: label,
      cluster_method: "semantic_key_v01",
      cluster_confidence: Math.round(bestScore * 100) / 100,
    };
  }
  return { cluster_key: c, cluster_label: c, cluster_method: "heuristic_v05", cluster_confidence: 1 };
}

export async function clusterAssignmentForTopic(
  existing: ExistingClusterState | null | undefined,
  assignNew: () => Promise<ClusterResult>,
) {
  if (!existing) return await assignNew();
  return {
    cluster_key: existing.cluster_key ?? null,
    cluster_label: existing.cluster_label ?? null,
    cluster_method: existing.cluster_method ?? null,
    cluster_confidence: existing.cluster_confidence ?? null,
    parent_key: existing.metadata?.parent_key,
    parent_label: existing.metadata?.parent_label,
  };
}
