/*
  タスクの計算のルール。アプリ(行軍表)とActionsの両方がこのファイルを使う。

  数字は保存しない。タスクの定義と毎日の記録を、最初の日から順にたどって
  累計・連続・最長連続・未実行連続・世代内累計・貯金・状況を毎回出し直す。
  同じ記録からは必ず同じ結果が出るので、持ち越しのずれや上書きが起きない。

  規則は Notion 時代の毎朝の生成(generate_daily_tasks v23)と同じ。
    - 新規は累計3で進行中へ。未実行2日連続で要再設定
    - 進行中は未実行3日連続で要再設定。14日連続で定着
    - 定着は60日連続で熟達。1日でも落とせば進行中へ
    - 熟達は落とせば定着へ
    - 実験と随時は上がりも落ちもしない
    - 「今日は該当しない」は無かった日として扱う。連続を保ち、累計は増やさない
    - 定着と熟達は記録が無ければ完了、随時は該当しない、貯金が1日分あれば完了
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TaskEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DONE = new Set(["完了", "超過完了", "不完全な完了"]);
  const EXCUSED = new Set(["今日は該当しない"]);
  const AUTO_DONE = new Set(["定着", "熟達"]);
  // 毎日の行が立つ状況。休止中・実験終了・殿堂入り・達成済み・アーカイブは立たない
  const GENERATED = new Set(["新規", "進行中", "要再設定", "実験", "定着", "熟達", "随時"]);
  const RULES = { PROMOTE_AT: 3, DROP_NEW_AT: 2, DROP_ACTIVE_AT: 3, TO_SETTLED: 14, TO_MASTERED: 60 };
  const WEEKDAYS = "月火水木金土日";

  function addDays(d, n) {
    const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  }
  function weekdayMon0(d) { return (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; }

  // 実行間隔。空欄なら毎日、数字があれば最終達成日からその日数ごと、曜日があればその曜日だけ
  function isDue(spec, day, lastDone) {
    spec = (spec || "").trim();
    if (!spec) return true;
    const m = spec.match(/(\d+)/);
    if (m) {
      const n = +m[1];
      if (n <= 1 || !lastDone) return true;
      return daysBetween(lastDone, day) >= n;
    }
    const days = Array.from(spec).filter(c => WEEKDAYS.includes(c));
    if (days.length) return days.includes(WEEKDAYS[weekdayMon0(day)]);
    return true;
  }

  // その日の終わりに、明日の状況を決める
  function nextStatus(cur, check, total, miss, prevStreak) {
    if (cur === "実験" || cur === "随時") return cur;
    const done = DONE.has(check), excused = EXCUSED.has(check);
    const streak = prevStreak + (done ? 1 : 0);
    const missed = !done && !excused;
    if (cur === "熟達") return missed ? "定着" : "熟達";
    if (cur === "定着") return missed ? "進行中" : (streak >= RULES.TO_MASTERED ? "熟達" : "定着");
    if (cur === "新規") {
      if (total >= RULES.PROMOTE_AT) return "進行中";
      if (miss >= RULES.DROP_NEW_AT) return "要再設定";
      return "新規";
    }
    if (cur === "進行中") {
      if (!missed && streak >= RULES.TO_SETTLED) return "定着";
      if (miss >= RULES.DROP_ACTIVE_AT) return "要再設定";
      return "進行中";
    }
    return cur;
  }

  function sortBy(arr, key) {
    return (arr || []).slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  }
  function genAt(gens, day) {
    let g = { gen: 1, from: null };
    for (const x of gens) if (x.from <= day) g = x;
    return g;
  }

  /*
    def   タスクの定義
    logFor(day)  その日の記録を返す関数。無ければ undefined
    until  ここまでたどる(この日を含む)

    返すもの
      days  行が立った日ごとの、その日の朝の状態
      next  until の日の終わりの状態(=翌朝の状態)
  */
  function replay(def, logFor, until) {
    const ini = def.initial || {};
    let st = {
      status: ini.status || "新規",
      total: +ini.total || 0, streak: +ini.streak || 0, best: +ini.best || 0, miss: +ini.miss || 0,
      lastDone: ini.lastDone || null, bank: +ini.bank || 0, prevBooking: ini.prevBooking || "",
      genTotal: ini.genTotal != null ? +ini.genTotal : (+ini.total || 0),
    };
    const gens = sortBy(def.generations, "from");
    const events = sortBy(def.events, "date");
    let gen = genAt(gens, def.created).gen || 1;
    const quota = +def.quota || 0;
    const imported = def.importedUntil || null;
    const days = [];
    if (!def.created || def.created > until) return { days, next: st, gen };

    let ei = 0;
    for (let day = def.created; day <= until; day = addDays(day, 1)) {
      const todays = [];
      while (ei < events.length && events[ei].date <= day) {
        if (events[ei].date === day) todays.push(events[ei]);
        ei++;
      }
      // 休止中から再開する出来事は、行が立つ前に効かせる
      if (!GENERATED.has(st.status)) {
        const revive = todays.find(e => e.status && GENERATED.has(e.status));
        if (revive) st.status = revive.status;
      }

      let rec = logFor(day);
      // 取り込んだ最後の日に、ルールでは行が立つはずなのにNotionに行が無かったタスクは、
      // Notionでもうやめていたもの。切り替えのあとは行を立てず、アーカイブとして扱う
      // (実行間隔で休みの日だったものは、行が無くて当然なので当てはまらない)
      // STAGE・WAVEが「進行中」でない日は、そのタスクの行を立てない(切り替えた日から効く。過去は書き換えない)
      if (def.gate && day >= def.gate.start && !gateOpen(def.gate, day) && !rec) continue;
      if (imported && day === imported && !rec && !def.noDrop && GENERATED.has(st.status) && isDue(def.interval, day, st.lastDone)) {
        st.status = "アーカイブ"; st.dropped = imported;
        continue;
      }
      // 取り込んだ期間は、Notionに行があった日がそのまま行の立つ日
      const generated = (imported && day <= imported)
        ? !!rec
        : GENERATED.has(st.status) && isDue(def.interval, day, st.lastDone);
      if (!generated) continue;
      rec = rec || {};

      // 世代が上がった日から、世代内累計を数え直す
      const g = genAt(gens, day);
      if ((g.gen || 1) !== gen) {
        if ((g.gen || 1) > gen) st.genTotal = 0;
        gen = g.gen || 1;
      }

      // その日の行に手で入れた変更(状況・数字の直し)
      const firstGen = gens.length ? (gens[0].gen || 1) : 1;
      for (const e of todays) {
        if (e.status) st.status = e.status;
        if (e.set) {
          // 最初の世代のあいだは、世代内累計は累計と同じ。累計を直したら同じだけ動かす
          if ("total" in e.set && !("genTotal" in e.set) && gen === firstGen) {
            st.genTotal += (+e.set.total || 0) - st.total;
          }
          Object.assign(st, e.set);
        }
      }

      let check = rec.check;
      if (!check) {
        if (AUTO_DONE.has(st.status)) check = "完了";
        else if (st.status === "随時") check = "今日は該当しない";
        else if (quota > 0 && st.bank >= quota) check = "完了";
        else if (quota > 0 && st.bank > 0) check = "進行中";
        else check = "未着手";
      }

      days.push({
        date: day, status: st.status, check, gen, genTotal: st.genTotal,
        total: st.total, streak: st.streak, best: st.best, miss: st.miss, lastDone: st.lastDone,
        bank: quota > 0 ? st.bank : null, prevBooking: st.prevBooking, rec,
      });

      // その日の終わり
      const done = DONE.has(check), excused = EXCUSED.has(check);
      const total = st.total + (done ? 1 : 0);
      const streak = done ? st.streak + 1 : (excused ? st.streak : 0);
      const best = Math.max(st.best, streak);
      const miss = done ? 0 : (excused ? st.miss : st.miss + 1);
      const lastDone = done ? day : st.lastDone;
      st = {
        status: nextStatus(st.status, check, total, miss, st.streak),
        total, streak, best, miss, lastDone,
        genTotal: st.genTotal + (done ? 1 : 0),
        bank: quota > 0 ? Math.round((st.bank + (+rec.did || 0) - quota) * 100) / 100 : 0,
        prevBooking: rec.nextBooking || "",
      };
    }
    return { days, next: st, gen };
  }

  /*
    サイクル。決まった中身を順番に回す。やった日だけ次へ進む。
      cycle = { items: ["過去の語彙", "未来の語彙", ...], anchorDate, anchorIndex }
    anchorDate の日は anchorIndex 番目で、そこから完了した日の数だけ進む。
    休んだ日は進まないので、回す中身に偏りが出ない。
  */
  function cycleIndex(cycle, days, today) {
    if (!cycle || !Array.isArray(cycle.items) || !cycle.items.length) return null;
    const n = cycle.items.length;
    const from = cycle.anchorDate || today;
    let done = 0;
    for (const d of days) {
      if (d.date >= from && d.date < today && DONE.has(d.check)) done++;
    }
    const i = (((+cycle.anchorIndex || 0) + done) % n + n) % n;
    return { index: i, item: cycle.items[i], count: n };
  }

  /*
    アプリで変えたこと(overlay)を、取り込んだ定義に重ねる。アプリの画面と毎朝の計算の両方が使う。
      edits        中身の変更(名前、時間帯、攻守、省、WAVE・STAGE、実行間隔、重み、目標回数、達成要件、1日の分量、型)
      events       状況の変更(休止、再開、立て直し、アーカイブなど)
      generations  世代を上げた記録
    同じ変更がNotion経由でも入ってくることがあるが、2回効いても結果は同じになる。
  */
  const EDIT_KEYS = ["name", "slot", "stance", "interval", "weight", "requirement", "quota", "kind"];
  function mergeOverlay(def, ov, today) {
    ov = ov || {};
    const e = ov.edits || {};
    const out = Object.assign({}, def);
    for (const k of EDIT_KEYS) if (e[k] !== undefined) out[k] = e[k];
    if (Array.isArray(e.ministries)) out.ministries = e.ministries.slice();
    if (Array.isArray(e.waves)) out.waves = e.waves.map(l => ({ label: l, url: "" }));
    if (e.name && e.name !== def.name) out.aliases = Array.from(new Set((def.aliases || []).concat([def.name])));
    const gens = (def.generations || []).map(g => Object.assign({}, g));
    for (const g of ov.generations || []) if (!gens.some(x => x.gen === g.gen && x.from === g.from)) gens.push(Object.assign({}, g));
    gens.sort((a, b) => (a.from < b.from ? -1 : 1));
    if (e.target !== undefined && e.target !== null && e.target !== "") {
      const cur = gens.filter(g => g.from <= today).pop();
      if (cur) cur.target = +e.target; else gens.push({ gen: 1, from: def.created, target: +e.target });
    }
    out.generations = gens;
    out.events = (def.events || []).concat(ov.events || []);
    out.cycle = ov.cycle || def.cycle || null;
    return out;
  }

  // 取り込んだタスクと、アプリで足したタスク(まだ取り込みに戻ってきていないもの)を合わせる
  // 削除の印を付けたものは除く(戻せるように、印だけで消す)
  function allDefs(defsDoc, overlay, withDeleted) {
    const defs = (defsDoc && defsDoc.tasks) || [];
    const have = new Set(defs.map(d => d.id));
    const all = defs.concat(((overlay && overlay.newTasks) || []).filter(t => !have.has(t.id)));
    if (withDeleted) return all;
    const ov = (overlay && overlay.tasks) || {};
    return all.filter(d => !(ov[d.id] && ov[d.id].deleted));
  }

  // その日の記録。アプリでつけたものがあれば、取り込んだものより優先する
  function mergedLogFor(logs, applogs, id) {
    return day => {
      const m = day.slice(0, 7);
      const a = (((logs || {})[m] || {})[day] || {})[id];
      const b = (((applogs || {})[m] || {})[day] || {})[id];
      if (!a && !b) return undefined;
      return Object.assign({}, a || {}, b || {});
    };
  }

  // その日の世代の目標回数
  function targetAt(def, day) {
    const g = (def.generations || []).filter(x => x.from <= day).sort((a, b) => (a.from < b.from ? -1 : 1)).pop();
    return g && g.target != null ? +g.target : null;
  }

  // 記録の束(月ごとのファイルを合わせたもの)から、logFor を作る
  function makeLogFor(logs, taskId) {
    return day => {
      const month = logs[day.slice(0, 7)];
      const d = month && month[day];
      return d ? d[taskId] : undefined;
    };
  }


  // ── STAGE・WAVEの状態で、タスクを効かせるかどうか ──
  // ページの状態の記録(statusLog)から「進行中」の期間を出し、結びついたタスクに gate を付ける
  function gateOpen(g, day){ return g.ranges.some(([a, z]) => day >= a && (!z || day < z)); }
  const normSt = s => (s === "未着手" || !s) ? "作成中" : s;
  function applyGates(defs, pagesDoc){
    const ps = ((pagesDoc && pagesDoc.pages) || []).filter(p => !p.deleted && !p.imported && (p.kind === "STAGE" || p.kind === "WAVE"));
    if (!ps.length) return defs;
    const all = (pagesDoc.pages || []);
    const tagOf = p => { let c = p, g = 0; while (c && g++ < 50) { if (String(c.parent).indexOf("m:") === 0) return c.parent.slice(2); const pid = c.parent; c = all.find(x => x.id === pid); } return null; };
    const byId = new Map(ps.map(p => [p.id, p]));
    const byKey = new Map(ps.map(p => [tagOf(p) + "|" + String(p.label).toUpperCase(), p]));
    return defs.map(d => {
      const linked = [];
      for (const w of d.waves || []) {
        const m = /#page=([\w-]+)/.exec((w && w.url) || "");
        let p = m ? byId.get(m[1]) : null;
        if (!p) { const lab = String((w && w.label) || w || "").replace(/\s+/g, "").toUpperCase(); for (const t of d.ministries || []) { p = byKey.get(t + "|" + lab); if (p) break; } }
        if (p && linked.indexOf(p) < 0) linked.push(p);
      }
      if (!linked.length) return d;
      const ranges = []; let start = null;
      for (const p of linked) {
        const log = (p.statusLog && p.statusLog.length ? p.statusLog : [{ date: p.created || "2000-01-01", status: p.status }]).slice().sort((a, b) => a.date < b.date ? -1 : 1);
        if (!start || log[0].date < start) start = log[0].date;
        log.forEach((x, i) => { if (normSt(x.status) === "進行中") ranges.push([x.date, log[i + 1] ? log[i + 1].date : null]); });
      }
      return Object.assign({}, d, { gate: { start, ranges } });
    });
  }

  return { applyGates, gateOpen, replay, makeLogFor, cycleIndex, mergeOverlay, allDefs, mergedLogFor, targetAt, nextStatus, isDue, addDays, daysBetween, DONE, EXCUSED, AUTO_DONE, GENERATED, RULES };
});
