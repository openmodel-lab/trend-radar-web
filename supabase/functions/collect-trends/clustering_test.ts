import {
  matchesEventDefinition,
  priorityEventCluster,
  selectCluster,
  semanticKeyMatches,
  type ClusterCandidate,
} from "./clustering.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function candidate(title: string, cluster_key: string, cluster_label = cluster_key): ClusterCandidate {
  return { title, cluster_key, cluster_label };
}

function expectInherited(title: string, expectedKey: string, existingTitle = title) {
  const result = selectCluster(title, [candidate(existingTitle, expectedKey)]);
  assert(result.cluster_key === expectedKey, `${title} did not inherit ${expectedKey}: ${result.cluster_key}`);
  assert(result.cluster_method === "semantic_key_v01", `${title} did not use semantic_key_v01`);
}

Deno.test("1 BE:FIRST semantic key passes", () => {
  expectInherited("BE:FIRST 新曲 MV公開", "entity:be_first", "BE:FIRST / WATCH ME feat. BIA -Music Video-");
});

Deno.test("2 Asian Games alias passes", () => {
  expectInherited("アジア大会 卓球 日本代表", "entity:愛知名古屋アジア大会", "愛知・名古屋アジア大会 開幕");
});

Deno.test("3 a new cluster can bootstrap its second topic", () => {
  expectInherited("映画ABC 公開日", "entity:映画abc", "映画ABC");
});

Deno.test("4 explicit short entity alias passes", () => {
  expectInherited("日銀 利上げ", "日銀", "日本銀行が政策金利を発表");
});

Deno.test("5 Fujii Kaze alias passes normalized cluster", () => {
  expectInherited("Fujii Kaze New Song", "藤井風", "藤井風 公式");
});

Deno.test("6 Attack on Titan alias passes normalized cluster", () => {
  expectInherited("Attack on Titan New Movie", "進撃の巨人", "進撃の巨人 新作映画");
});

Deno.test("7 middle dot is ignored for Max Muncy", () => {
  expectInherited("マックス・マンシー", "entity:マックスマンシー", "マックスマンシー 最新情報");
});

Deno.test("8 middle dot is ignored for Edwin Diaz", () => {
  expectInherited("エドウィン・ディアス", "entity:エドウィンディアス", "エドウィンディアス 最新情報");
});

Deno.test("9 Takaishi drama cannot enter BE:FIRST", () => {
  assert(!semanticKeyMatches("高橋一生 主演ドラマ", "entity:be_first"), "bridge pollution passed semantic gate");
});

Deno.test("10 Ghibli Park cannot enter Asian Games", () => {
  assert(!semanticKeyMatches("ジブリパーク 新エリア", "entity:愛知名古屋アジア大会"), "unrelated topic passed semantic gate");
});

Deno.test("11 polluted BE:FIRST members cannot outvote semantic key", () => {
  const members = [
    candidate("BE:FIRST / WATCH ME feat. BIA -Music Video-", "entity:be_first", "BE:FIRST"),
    candidate("BE:FIRST・LEO、高橋一生主演ドラマで共演", "entity:be_first", "BE:FIRST"),
    candidate("高橋一生 ドラマ", "entity:be_first", "BE:FIRST"),
    candidate("高橋一生主演のNHKオムニバスドラマ", "entity:be_first", "BE:FIRST"),
  ];
  const result = selectCluster("高橋一生 主演ドラマ", members);
  assert(result.cluster_key !== "entity:be_first", "polluted members overrode semantic gate");
});

Deno.test("12 generic typhoon key does not grow", () => {
  assert(!semanticKeyMatches("台風 接近", "台風"), "generic short key passed");
});

Deno.test("13 ambiguous short place key does not grow", () => {
  assert(!semanticKeyMatches("岐阜 ニュース", "岐阜"), "ambiguous short key passed");
});

Deno.test("14 generic news key does not grow", () => {
  assert(!semanticKeyMatches("ニュース 速報", "ニュース"), "generic key passed");
});

Deno.test("15 incomplete fujii key does not grow", () => {
  const result = selectCluster("Fujii Kaze New Song", [candidate("Fujii Kaze - You", "fujii")]);
  assert(result.cluster_key !== "fujii", "incomplete legacy key grew");
  assert(result.cluster_key === "藤井風", "new normalized Fujii cluster was not created");
});

Deno.test("16 incomplete attack key does not grow", () => {
  const result = selectCluster("Attack on Titan New Movie", [candidate("Attack on Titan Trailer", "attack")]);
  assert(result.cluster_key !== "attack", "incomplete legacy key grew");
  assert(result.cluster_key === "進撃の巨人", "new normalized Titan cluster was not created");
});

Deno.test("17 internal topic key does not grow", () => {
  const title = "パンサー向井と若林有子アナの熱愛";
  const result = selectCluster(title, [candidate(title, "topic:944")]);
  assert(result.cluster_key !== "topic:944", "internal topic key grew");
});

Deno.test("18 priority event behavior stays ahead of candidate matching", () => {
  const cases: [string, string][] = [
    ["トランプ氏とグリーンランドを巡りデンマークが協議", "event:trump_greenland"],
    ["高市内閣 支持率を発表", "event:takaichi_approval"],
    ["習近平が体調不良で救急搬送との情報", "event:xi_health_rumor"],
    ["折りたたみiPhone Duoを発表", "event:iphone_duo_foldable"],
    ["iPhone 18 Pro 発表", "event:iphone18_pro"],
  ];
  for (const [title, key] of cases) {
    const forced = priorityEventCluster(title);
    assert(forced?.key === key, `${key} priority behavior changed`);
    const result = selectCluster(title, []);
    assert(result.cluster_key === key && result.cluster_method === "event_child_v01", `${key} was not forced`);
  }
});

Deno.test("19 event semantic mismatch cannot be revived by exact member similarity", () => {
  const title = "イラン 米国との戦闘終結条件を提示";
  assert(!matchesEventDefinition(title, "event:semiconductor_capacity"), "unrelated event definition passed");
  const result = selectCluster(title, [candidate(title, "event:semiconductor_capacity", "半導体 生産能力")]);
  assert(result.cluster_key !== "event:semiconductor_capacity", "exact member similarity overrode event gate");
});

Deno.test("20 Middle East news cannot enter semiconductor capacity event", () => {
  const result = selectCluster("フーシ派がサウジ施設を攻撃", [
    candidate("半導体の生産能力で中国が首位", "event:semiconductor_capacity", "半導体 生産能力"),
  ]);
  assert(result.cluster_key !== "event:semiconductor_capacity", "Middle East news entered semiconductor event");
});

Deno.test("21 a polluted majority cannot outvote semiconductor event semantics", () => {
  const members: ClusterCandidate[] = [
    candidate("半導体の最大産地は台湾か韓国か 生産能力で中国が首位", "event:semiconductor_capacity", "半導体 生産能力"),
    ...Array.from({ length: 5 }, (_, index) =>
      candidate(`イラン 米国との戦闘終結条件を提示 ${index}`, "event:semiconductor_capacity", "日本経済新聞")),
    ...Array.from({ length: 4 }, (_, index) =>
      candidate(`フーシ派がサウジ首都と石油施設を攻撃 ${index}`, "event:semiconductor_capacity", "日本経済新聞")),
    ...Array.from({ length: 4 }, (_, index) =>
      candidate(`中東情勢を巡り各国が協議 ${index}`, "event:semiconductor_capacity", "日本経済新聞")),
  ];
  const title = "イラン 米国との戦闘終結条件を提示";
  const result = selectCluster(title, members);
  assert(result.cluster_key !== "event:semiconductor_capacity", "polluted majority overrode semantic event gate");
  assert(result.cluster_method === "heuristic_v05", "rejected title did not create a fresh canonical cluster");
});
