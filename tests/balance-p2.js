// 2부 전체 진행 시뮬 (실제 게임 함수) — 우주 여러 번, 5000층까지
window.P2SIM = function (o) {
  o = Object.assign({ hours: 400, cps: 3, dt: 5, stall: 2 }, o || {});
  window.confirm = () => true; window.toast = () => {}; SFX.tone = () => {};
  S = Object.assign(defaultState(), { part: 2, crunch: S.crunch, alt: null });
  S.tut = 99; R.discQueue = []; R.buyAmt = 1; R.sellAmt = 1;
  const log = [], wT = {}, uT = {}, capT = {};
  let t = 0, bBudget = 0, lastBat = 0, stuckFrom = 0, stuckSt = -1, maxStuck = [0, 0];
  const H = h => (h / 3600).toFixed(1) + 'h';
  const targetWeap = () => { for (let z = 118; z >= 1; z--) if (S.disc[z] && !S.weap[z]) return z; return 0; };
  const need = () => {
    const r = {}, nz = p2NextZ();
    if (nz && S.battle.maxStage >= p2UnlockStage(nz)) r[nz - 1] = (r[nz - 1] || 0) + p2UnlockCost(nz);
    const tw = targetWeap();
    if (tw) for (const [k, n] of Object.entries(weapRecipe(tw))) r[k] = (r[k] || 0) + n;
    return r;
  };
  const steps = o.hours * 3600 / o.dt;
  for (let i = 0; i < steps; i++) {
    t += o.dt;
    const nz = p2NextZ(), st = nz ? p2UnlockStage(nz) : Infinity;
    let mz = 0;
    if (nz && S.battle.maxStage >= st && S.counts[nz - 1] < p2UnlockCost(nz)) mz = nz - 1;
    else {
      const tw = targetWeap();
      if (tw) { let best = 0; for (const [k, n] of Object.entries(weapRecipe(tw))) { const miss = (n - S.counts[k]) * EL_VALUE[k]; if (miss > best) { best = miss; mz = +k; } } }
    }
    if (!mz) { mz = 1; for (let z = 118; z >= 1; z--) if (S.disc[z]) { mz = z; break; } } // 할 일 없으면 팔기 좋은 무거운 원소
    S.p2z = mz;
    produceFor(o.dt);
    p2Mine(clickValue(false) * o.cps * o.dt);
    if (nz && S.battle.maxStage >= st && S.counts[nz - 1] >= p2UnlockCost(nz)) {
      if (!uT[nz]) uT[nz] = [t, baseRate(), S.battle.maxStage, S.prestige.count];
      p2Unlock(); R.discQueue = [];
    }
    for (let z = 118; z >= 1; z--) if (canCraft(z)) {
      for (const [k, n] of Object.entries(weapRecipe(z))) S.counts[k] -= n;
      S.weap[z] = 1; if (!wT[z]) wT[z] = t;
    }
    const nd = need(), resH = Math.min(nd[1] || 0, S.counts[1] * 0.5);
    let spend = Math.max(0, S.counts[1] - resH);
    for (const u of UPGRADES) if (!S.upg[u.id] && upgVisible(u) && u.cost <= spend) { S.counts[1] -= u.cost; spend -= u.cost; S.upg[u.id] = true; }
    for (const id of ['atkLv', 'hpLv', 'clickLv']) { const r = REPEATS.find(x => x.id === id); let c; while ((c = r.cost(S[id])) <= spend * 0.25) { S.counts[1] -= c; spend -= c; S[id]++; } }
    for (let k = 0; k < 60; k++) {
      let bi = -1, bv = 0;
      for (let g = 0; g < genN(); g++) { const c = genCost(g, 1); if (c <= spend * 0.5) { const v = GENERATORS[g].rate / c; if (v > bv) { bv = v; bi = g; } } }
      if (bi < 0) break;
      const c = genCost(bi, 1); S.counts[1] -= c; spend -= c; S.gens[bi]++;
    }
    // 코인: 필요 없는 원소의 1%를 팔아 파티 무기 강화
    if (i % 4 === 0) {
      for (let z = 2; z <= 118; z++) if (S.disc[z]) { const ex = S.counts[z] - (nd[z] || 0) * 1.2; if (ex >= 100) { const n = Math.floor(ex * 0.05); S.counts[z] -= n; S.coins = capB(S.coins + sellPrice(z) * rebUpgMult('coin') * n); } }
      if (typeof p2Exchange === 'function') { S.playTime = t; p2Exchange(); }
      for (let k = 0; k < (o.noWeap ? 0 : 60); k++) {
        let bz = 0, bc = Infinity;
        for (const z of S.party) if (z && S.weap[z]) { const c = wlvCost(z); if (c < bc) { bc = c; bz = z; } }
        if (!bz || bc > S.coins) break;
        S.coins -= bc; S.wlv[bz] = (S.wlv[bz] || 0) + 1;
      }
    }
    if (i % 12 === 0) checkAchs();
    bBudget += o.dt;
    if (t - lastBat >= 20) {
      lastBat = t;
      const B = S.battle;
      for (let g = 0; g < 400 && bBudget > 0; g++) {
        const tryS = Math.min(stageCap(), MAX_STAGE - 1, Math.max(B.maxStage + 1, warpStage()));
        if (tryS <= B.maxStage) { // 상한: 지금 층 반복 사냥
          const r = bestDeck(B.maxStage); if (!r) { bBudget = 0; break; }
          S.party = r.team.map(u => u.z).concat([0, 0, 0, 0, 0]).slice(0, 5);
          if (r.result.win) dropFor(B.maxStage, bBudget / (r.result.ttk + 0.6));
          bBudget = 0; break;
        }
        let r = bestDeck(tryS);
        if (r && !r.result.win && tryS > B.maxStage + 1) { const r1 = bestDeck(B.maxStage + 1); if (r1 && r1.result.win) { r = r1; } }
        if (!r) { bBudget = 0; break; }
        const stg2 = r.E.stage;
        S.party = r.team.map(u => u.z).concat([0, 0, 0, 0, 0]).slice(0, 5);
        if (!r.result.win) {
          if (B.maxStage > 0) { const r2 = evalTeam(partyUnits(), makeEnemy(B.maxStage)); if (r2.win) dropFor(B.maxStage, bBudget / (r2.ttk + 0.6)); }
          bBudget = 0; break;
        }
        const cost = r.result.ttk + 0.6;
        if (cost > bBudget) { bBudget = Math.min(bBudget, 120); break; }
        bBudget -= cost; dropFor(stg2, 1);
        B.maxStage = stg2;
      }
      if (B.maxStage !== stuckSt) { const d = t - stuckFrom; if (d > maxStuck[0] && stuckSt > 0 && stuckSt < Math.min(stageCap(), MAX_STAGE - 1)) maxStuck = [d, stuckSt, S.prestige.count]; stuckSt = B.maxStage; stuckFrom = t; }
    }
    const capKey = S.prestige.count;
    if (S.battle.maxStage >= Math.min(stageCap(), MAX_STAGE - 1) && !capT[capKey]) { capT[capKey] = t; log.push(`${H(t)} 우주 ${capKey} 층 상한 ${S.battle.maxStage} 도달 · 무기 ${S.weap.filter(Boolean).length} · 초당 ${fmt(baseRate())}`); }
    if (canRebirth() && (S.battle.maxStage >= Math.min(stageCap(), MAX_STAGE - 1) || (stuckSt === S.battle.maxStage && t - stuckFrom > o.stall * 3600))) {
      if (S.prestige.count < 12 || S.prestige.count % 10 === 0) log.push(`${H(t)} 🌌 환생 ${S.prestige.count + 1}회 · 원소 ${discCount()}/${rbNeedN()} · 무기 ${S.weap.filter(Boolean).length} · 층 ${S.battle.maxStage}`);
      rebirth(); R.discQueue = []; R.buyAmt = 1; R.sellAmt = 1; stuckSt = -1;
    }
    if (i % (3600 * 15 / o.dt) === 0 && i) { const wl = S.party.filter(Boolean).map(z => S.wlv[z] || 0); log.push(`${H(t)} 층 ${S.battle.maxStage} · 이온빔 Lv${S.atkLv} (×${fmt(Math.pow(repEff(), S.atkLv))}) · 무기강화 평균 +${(wl.reduce((a,b)=>a+b,0)/Math.max(1,wl.length)).toFixed(0)} (×${fmt(Math.pow(1.25, wl.reduce((a,b)=>a+b,0)/Math.max(1,wl.length)))}) · 코인 ${fmt(S.coins)}`); }
    if (S.battle.maxStage >= MAX_STAGE - 1) { log.push(`${H(t)} 🏁 4999층 도달`); break; }
  }
  function dropFor(stage, kills) {
    const boss = stage % 5 === 0;
    const reward = 10 * stageGrowth(stage, 1.18, 1.05, 1.02) * (boss ? 5 : 1) * (S.upg.gravity ? 5 : 1) * (boss ? 2 : 1) * kills;
    const dz = []; for (let z = 1; z <= 118; z++) if (S.disc[z]) dz.push(z);
    const N = dz.length, sm = 8;
    for (let s = 0; s < sm; s++) { const z = dz[Math.min(N - 1, Math.floor(N * (1 - Math.pow((s + 0.5) / sm, 2.5))))]; S.counts[z] += Math.max(kills / sm, reward / sm / EL_VALUE[z]); }
    if (typeof p2KillCoins === 'function') S.coins = capB(S.coins + p2KillCoins(stage, boss) * kills);
  }
  const heq = z => Object.entries(weapRecipe(z)).reduce((a, [k, n]) => a + n * EL_VALUE[k], 0);
  const tbl = [2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 92, 96, 100, 103, 106, 109, 111, 114, 116, 117, 118].map(z => uT[z]
    ? `${EL[z].sym}(${z}) | 해금 ${H(uT[z][0])} 우주${uT[z][3]} 층${uT[z][2]} | 초당 ${fmt(uT[z][1])} | 재료 ${fmt(heq(z))}H = ${fmtSec(heq(z) / uT[z][1])} | 제작 ${wT[z] ? H(wT[z]) : '-'}` : `${z} 미해금`).join('\n');
  window.P2LAST = { uT, wT };
  return tbl + '\n' + log.join('\n') + `\n최종 ${H(t)} 층 ${S.battle.maxStage} 환생 ${S.prestige.count} 무기 ${S.weap.filter(Boolean).length} · 가장 오래 막힘 ${H(maxStuck[0])} (${maxStuck[1]}층, 우주 ${maxStuck[2]})`;
};
