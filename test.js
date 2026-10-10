// 行軍表のテスト(手順録のサイクルの現在地と、今日の手順):node test.js
// 手順録の core.js が要る。既定では ../tejunroku/core.js を読む(TEJUNROKU_CORE で場所を変えられる)
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

const HTML = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const ENGINE = fs.readFileSync(path.join(__dirname, "engine.js"));
const CORE_PATH = process.env.TEJUNROKU_CORE || path.join(__dirname, "..", "tejunroku", "core.js");
const CORE = fs.readFileSync(CORE_PATH);
const E = require("./engine.js");

const TODAY = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);   // 朝5時区切り
const D = n => E.addDays(TODAY, -n);
const md = d => (+d.slice(5, 7)) + "/" + (+d.slice(8, 10));

class Loader extends ResourceLoader {
  constructor(opt) { super(); this.opt = opt || {}; this.asked = []; }
  fetch(url) {
    this.asked.push(url);
    if (url.endsWith("/roadmap/engine.js")) return Promise.resolve(ENGINE);
    if (url.endsWith("/tejunroku/core.js")) return this.opt.coreFails ? Promise.reject(new Error("つながらない")) : Promise.resolve(CORE);
    return null;
  }
}

/* GitHub のにせもの */
function makeGH(files) {
  const store = {}; let n = 0;
  for (const [p, v] of Object.entries(files)) store[p] = { text: JSON.stringify(v), sha: "s" + (++n) };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const gh = { store, gets: [] };
  gh.fetch = async (url, opts = {}) => {
    const m = url.match(/^https:\/\/api\.github\.com\/repos\/me\/notion-daily\/contents\/([^?]+)/);
    if (!m) return res(404, {});
    const p = decodeURIComponent(m[1]);
    if (!opts.method || opts.method === "GET") {
      gh.gets.push(p);
      const f = store[p];
      if (f) return res(200, { content: Buffer.from(f.text).toString("base64"), sha: f.sha });
      const kids = Object.keys(store).filter(k => k.startsWith(p + "/"));
      if (kids.length) return res(200, kids.map(k => ({ name: k.slice(p.length + 1), sha: store[k].sha, type: "file" })));
      return res(404, {});
    }
    const body = JSON.parse(opts.body);
    store[p] = { text: Buffer.from(body.content, "base64").toString("utf8"), sha: "s" + (++n) };
    return res(200, { content: { sha: store[p].sha } });
  };
  return gh;
}

/* 材料:3つのタスク */
function baseFiles(withTejun = true) {
  const mk = (id, name, extra) => Object.assign({ id, name, aliases: [], ministries: ["英語"], slot: "朝", created: D(6),
    initial: { status: "進行中", total: 10, streak: 0 }, generations: [{ gen: 1, from: D(6) }], events: [] }, extra || {});
  const files = {
    "roadmap/tasks.json": { date: TODAY, generated_at: "05:00", weights: {}, tasks: ["英単語", "数学演習", "音読"].map(name =>
      ({ name, slot: "朝", ministries: ["英語"], status: "進行中", check: "未着手" })) },
    "roadmap/settings.json": { version: 1, tasks: {
      "英単語": { min: 20, place: "机", organs: ["目", "手"], nagara: "no" },
      "数学演習": { min: 30, place: "机", organs: ["目", "手"], nagara: "no" },
      "音読": { min: 10, place: "机", organs: ["口"], nagara: "no" } } },
    "roadmap/tasks/defs.json": { version: 1, tasks: [
      mk("t1", "英単語"), mk("t2", "数学演習"),
      mk("t3", "音読", { cycle: { items: ["A", "B"], anchorDate: D(6), anchorIndex: 0 } })] },
  };
  // 3日おきに済ませる(未実行は1日ずつなので落ちない)
  for (const day of [D(5), D(3), D(1)]) {
    const p = "roadmap/tasks/applog/" + day.slice(0, 7) + ".json";
    files[p] = files[p] || {};
    files[p][day] = { t1: { check: "完了" }, t2: { check: "完了" }, t3: { check: "完了" } };
  }
  if (withTejun) {
    files["roadmap/apps/tejunroku/data.json"] = {
      version: 1,
      procs: [
        { id: "p1", name: "未来の語彙の日", steps: [
          { id: "h1", type: "section", title: "覚える" },
          { id: "h1a", type: "section", title: "1周目", level: 2 },
          { id: "s1", type: "do", text: "時間を計って {単語帳}", min: 15 },
          { id: "h1b", type: "section", title: "確かめる", level: 2 },
          { id: "s2", type: "branch", question: "全部覚えた?", options: [
            { id: "o1", label: "はい", steps: [{ id: "s3", type: "do", text: "次へ", min: 5 }] },
            { id: "o2", label: "いいえ", steps: [{ id: "s4", type: "do", text: "もう一周", min: 10 }] }] },
          { id: "h2", type: "section", title: "残す" },
          { id: "s5", type: "part", partId: "tp" },
          { id: "s6", type: "do", text: "1行目\n2行目", min: 5, max: 8 }] },
        { id: "p2", name: "演習の手順", steps: [{ id: "s9", type: "do", text: "例題を解く", min: 30 }] }],
      parts: [{ id: "tp", name: "Ankiに追加", steps: [{ id: "x1", type: "do", text: "カードを作る", min: 3 }] }],
      ranges: [{ id: "r1", name: "単語帳", unit: "語", start: 1, end: 1000, step: 100, atEnd: "stop", created: D(20), set: null }],
      cycles: [{ id: "c1", taskId: "t1", anchorDate: D(6), anchorIndex: 1, rules: [], items: [
        { id: "i1", name: "過去の語彙", procId: null }, { id: "i2", name: "未来の語彙", procId: "p1" }, { id: "i3", name: "長文", procId: null }] }],
      links: { t2: "p2" },
    };
    files["roadmap/apps/tejunroku/runs/" + D(1).slice(0, 7) + ".json"] = { [D(1)]: { t1: { advanced: ["r1"], at: D(1) + "T10:00:00Z" } } };
  }
  return files;
}

async function open(gh, opt) {
  const loader = new Loader(opt);
  // 画面の中で起きたエラーを集める(わざと読めなくした core.js の分だけは除く)
  const errors = [], vc = new VirtualConsole();
  vc.on("jsdomError", e => { if (!(opt && opt.coreFails && /Could not load script/.test(e.message))) errors.push(e.message + "\n" + (e.detail && e.detail.stack || "")); });
  const dom = new JSDOM(HTML, { virtualConsole: vc,
    url: "https://nisenonamae.github.io/roadmap/", runScripts: "dangerously", resources: loader, pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = gh.fetch; w.scrollTo = () => {}; w.confirm = () => true;
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;   // jsdom には無いので node のものを渡す
      w.Element.prototype.scrollIntoView = function () {};
      w.__roadmapRealtime = false;
      w.localStorage.setItem("roadmap-conn", JSON.stringify({ owner: "me", repo: "notion-daily", branch: "main", token: "tok" }));
    }
  });
  dom.loader = loader; dom.errors = errors;
  await new Promise(r => dom.window.addEventListener("load", r));
  await wait(dom, 300);
  return dom;
}
const wait = (dom, ms) => new Promise(r => dom.window.setTimeout(r, ms));
const $ = (dom, s) => dom.window.document.querySelector(s);
const $$ = (dom, s) => [...dom.window.document.querySelectorAll(s)];
const click = (dom, el) => { assert(el, "押すものが見つからない"); el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); };
const stopOf = (dom, name) => $$(dom, "#plan .stop").find(s => s.querySelector(".name") && s.querySelector(".name").textContent.replace("手順", "") === name);
const tab = (dom, v) => click(dom, $(dom, 'nav.tabs [data-view="' + v + '"]'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("今日のタブ:手順録のサイクルは全体の中の現在地で出る。名前を押せるものには「手順」の印", async () => {
  const dom = await open(makeGH(baseFiles()));
  const s1 = stopOf(dom, "英単語");
  assert(s1, "英単語の行がある");
  assert.strictEqual(s1.querySelector(".cyc-pos").textContent, "過去の語彙 ・ [未来の語彙] ・ 長文");
  assert(s1.querySelector(".tj-name .tj-tag"), "今の中身に手順書があるので印が付く");
  assert(!s1.textContent.includes("今日は "), "「今日は ◯◯」の出し方はやめた");
  // 行軍表の古いサイクルも同じ出し方
  assert.strictEqual(stopOf(dom, "音読").querySelector(".cyc-pos").textContent, "A ・ [B]");
  assert(!stopOf(dom, "音読").querySelector(".tj-tag"), "手順書が無いので印は無い");
  // サイクルが無く、タスクの手順書だけ
  const s2 = stopOf(dom, "数学演習");
  assert(!s2.querySelector(".cyc-pos"));
  assert(s2.querySelector(".tj-name .tj-tag"));
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("軽さ:手順を開くまで、手順の画面も core.js も範囲の記録も読まない", async () => {
  const gh = makeGH(baseFiles());
  const dom = await open(gh);
  assert.strictEqual($(dom, "#tj-sheet").innerHTML, "");
  assert.strictEqual($(dom, "#tj-sheet").hidden, true);
  assert(!dom.loader.asked.some(u => u.includes("tejunroku/core.js")), "core.js はまだ読まない");
  assert(!gh.gets.some(p => p.includes("tejunroku/runs")), "記録はまだ読まない");
  assert.strictEqual(gh.gets.filter(p => p === "roadmap/apps/tejunroku/data.json").length, 1, "定義は1回だけ読む");
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("名前を押すと今日の手順が開く:現在地と最後にやった日、今の中身の手順書、今日の範囲", async () => {
  const gh = makeGH(baseFiles());
  const dom = await open(gh);
  click(dom, stopOf(dom, "英単語").querySelector(".tj-name"));
  assert.strictEqual($(dom, "#tj-sheet").hidden, false);
  assert.match($(dom, "#tj-sheet").textContent, /手順を読み込んでいます/);
  await wait(dom, 300);
  assert(dom.window.TJCore, "core.js を読み込んだ");
  const rows = $$(dom, "#tj-sheet .tj-cyc li").map(li => li.textContent);
  assert.deepStrictEqual(rows, ["過去の語彙最後 " + md(D(1)), "未来の語彙今日最後 " + md(D(5)), "長文最後 " + md(D(3))]);
  assert($$(dom, "#tj-sheet .tj-cyc li")[1].classList.contains("now"));
  assert.match($$(dom, "#tj-sheet .tj-lab")[1].textContent, /「未来の語彙」の日の手順:未来の語彙の日/);
  assert.deepStrictEqual($$(dom, "#tj-sheet .tj-num").map(e => e.textContent), ["1", "2", "3", "3-a", "4"]);
  assert.match($$(dom, "#tj-sheet .tj-total")[1].textContent, /合計 28〜36分/);
  // 区切りと、その時間(分かれ道を選ぶ前は幅で)
  assert.deepStrictEqual($$(dom, "#tj-sheet .tj-div").map(e => e.textContent), ["覚える20〜25分", "1周目15分", "確かめる5〜10分", "残す8〜11分"]);
  assert.deepStrictEqual($$(dom, "#tj-sheet .tj-div").map(e => e.className), ["tj-div lv1", "tj-div lv2", "tj-div lv2", "tj-div lv1"]);
  // 時間の幅と、文の改行
  assert.strictEqual($$(dom, "#tj-sheet .tj-min").pop().textContent, "5〜8分");
  assert.strictEqual($$(dom, "#tj-sheet .tj-t").pop().textContent, "1行目\n2行目");
  assert.strictEqual($(dom, "#tj-sheet .tj-rng").textContent, "単語帳 101〜200語");
  // 分かれ道は選ぶとその先が出る(保存はしない)
  click(dom, $$(dom, "#tj-sheet [data-tj-pick]")[1]);
  assert.match($(dom, "#tj-sheet").textContent, /もう一周/);
  assert(!$(dom, "#tj-sheet").textContent.includes("次へ10"));
  assert.match($$(dom, "#tj-sheet .tj-total")[1].textContent, /選んだ道では 33〜36分/);
  assert.strictEqual($$(dom, "#tj-sheet .tj-div")[0].textContent, "覚える25分");
  // 閉じると中身を捨てる
  click(dom, $(dom, "#tj-sheet [data-tj-close]"));
  assert.strictEqual($(dom, "#tj-sheet").hidden, true);
  assert.strictEqual($(dom, "#tj-sheet").innerHTML, "");
  assert(!dom.window.document.body.classList.contains("tj-lock"));
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("サイクルの無いタスクはタスクの手順書、手順書の無いサイクルは現在地だけ。Escで閉じる", async () => {
  const dom = await open(makeGH(baseFiles()));
  click(dom, stopOf(dom, "数学演習").querySelector(".tj-name"));
  await wait(dom, 300);
  assert(!$(dom, "#tj-sheet .tj-cyc"));
  assert.match($(dom, "#tj-sheet").textContent, /今日の手順:演習の手順/);
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.strictEqual($(dom, "#tj-sheet").hidden, true);
  click(dom, stopOf(dom, "音読").querySelector(".cyc-pos"));
  assert.match($(dom, "#tj-sheet").textContent, /サイクル\(行軍表で作ったもの\)/);
  assert.match($(dom, "#tj-sheet").textContent, /今日の中身「B」には、手順書がありません/);
  assert.deepStrictEqual($$(dom, "#tj-sheet .tj-cyc li").map(li => li.textContent), ["A最後 " + md(D(1)), "B今日最後 " + md(D(3))]);
  // 後ろの暗い所を押しても閉じる
  click(dom, $(dom, "#tj-sheet"));
  assert.strictEqual($(dom, "#tj-sheet").hidden, true);
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("チェックのタブ:現在地が出て、押すと手順が開く(昨日の記録では出さない)", async () => {
  const dom = await open(makeGH(baseFiles()));
  tab(dom, "check");
  const row = $(dom, '#tk-today [data-recrow="t1"]');
  assert.strictEqual(row.querySelector(".cyc-pos").textContent, "過去の語彙 ・ [未来の語彙] ・ 長文");
  click(dom, row.querySelector(".tj-name"));
  await wait(dom, 300);
  assert.match($(dom, "#tj-sheet").textContent, /未来の語彙の日/);
  click(dom, $(dom, "#tj-sheet [data-tj-close]"));
  click(dom, $(dom, '[data-ckday="1"]'));
  assert(!$(dom, '#tk-today [data-recrow="t1"] .cyc-pos'));
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("タスクのタブ:一覧に現在地。手順録のサイクルは見るだけで、保存してもサイクルに触らない", async () => {
  const gh = makeGH(baseFiles());
  const dom = await open(gh);
  tab(dom, "tasks");
  assert.match($(dom, '#tk-list [data-tid="t1"]').textContent, /過去の語彙 ・ \[未来の語彙\] ・ 長文/);
  click(dom, $(dom, '#tk-list [data-tid="t1"]'));
  const det = $(dom, "#tk-detail");
  assert(!det.querySelector("[data-cycle-items]"), "手順録のサイクルは書き換える欄を出さない");
  assert.match(det.textContent, /このサイクルは手順録で作ったものです/);
  assert(det.querySelector('a[href="https://nisenonamae.github.io/tejunroku/"]'));
  assert.strictEqual(det.querySelectorAll(".tj-cyc li").length, 3);
  click(dom, det.querySelector("[data-tk-save]"));
  await wait(dom, 200);
  const ov = JSON.parse(gh.store["roadmap/tasks/overlay.json"].text);
  assert(!("cycle" in (ov.tasks.t1 || {})), "サイクルを書き込まない");
  // 行軍表の古いサイクルは今までどおり直せる
  click(dom, $(dom, '#tk-list [data-tid="t3"]'));
  assert(det.querySelector("[data-cycle-items]"));
  assert.strictEqual(det.querySelectorAll(".tj-cyc li").length, 2);
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("手順録のデータが無くても、今までどおり動く", async () => {
  const dom = await open(makeGH(baseFiles(false)));
  assert(!stopOf(dom, "英単語").querySelector(".cyc-pos"));
  assert(!stopOf(dom, "英単語").querySelector(".tj-name"));
  assert.strictEqual(stopOf(dom, "音読").querySelector(".cyc-pos").textContent, "A ・ [B]");
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("core.js を読めないときは、そう出る", async () => {
  const dom = await open(makeGH(baseFiles()), { coreFails: true });
  click(dom, stopOf(dom, "英単語").querySelector(".tj-name"));
  await wait(dom, 300);
  assert.match($(dom, "#tj-sheet").textContent, /手順を表示する部分を読み込めませんでした/);
  assert(!dom.window.document.querySelector(".err"));
  assert.deepStrictEqual(dom.errors, []);
  dom.window.close();
});

test("計算:サイクルの現在地(切り替えの記録・中身が多いとき・今日やった分)", async () => {
  const c = { items: [{ id: "a", name: "あ" }, { id: "b", name: "い" }, { id: "c", name: "う" }], anchorDate: "2026-10-01", anchorIndex: 0 };
  const days = [{ date: "2026-10-01", check: "完了" }, { date: "2026-10-02", check: "不実行" }, { date: "2026-10-03", check: "完了" }, { date: "2026-10-05", check: "完了" }];
  let p = E.cycleTrack(c, days, "2026-10-05");
  assert.strictEqual(p.item, "う");                    // 2回済ませて2つ進む。今日の分は明日から
  assert.deepStrictEqual(p.last, ["2026-10-01", "2026-10-03", "2026-10-05"]);
  // 10/4 に「あ」へ切り替えた
  p = E.cycleTrack(c, days, "2026-10-05", [{ date: "2026-10-04", to: "a" }]);
  assert.strictEqual(p.item, "あ");
  assert.strictEqual(p.last[0], "2026-10-05");
  // 古いサイクル(文の並び)でも、今までの cycleIndex と同じ答え
  const old = { items: ["x", "y", "z", "w"], anchorDate: "2026-10-01", anchorIndex: 2 };
  assert.strictEqual(E.cycleTrack(old, days, "2026-10-06").item, E.cycleIndex(old, days, "2026-10-06").item);
  assert.strictEqual(E.cycleTrack(null, days, "2026-10-06"), null);
});

(async () => {
  let ok = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; console.log("○ " + name); }
    catch (e) { console.log("× " + name + "\n   " + String(e.stack || e).split("\n").slice(0, 14).join("\n   ")); }
  }
  console.log("\n" + ok + "/" + tests.length + " 通過");
  process.exit(ok === tests.length ? 0 : 1);
})();
