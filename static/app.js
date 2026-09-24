"use strict";

const EXAMPLE_OK = [
  "起床,洗漱,10,30",
  "洗漱,早饭,15,45",
  "早饭,出门,20,60",
  "出门,开会,40,90",
  "起床,开会,80,240",
  "起床,早饭,25,90",
].join("\n");

// 矛盾示例：
// 1) 开会比早饭晚 30~60；2) 晚饭比开会晚 45~90；3) 早饭比晚饭晚 20~50
// 三式相加 0 <= 95~200 与第三式给出的“晚饭早于早饭”冲突，构成闭合负环。
const EXAMPLE_CONFLICT = [
  "早饭,开会,30,60",
  "开会,晚饭,45,90",
  "晚饭,早饭,20,50",
].join("\n");

const $ = (id) => document.getElementById(id);
const resultEl = $("result");
const redundancyEl = $("redundancy-result");
const inputEl = $("input");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderErrors(errors) {
  const items = errors.map((e) =>
    `<li>${esc(e.message)}</li>`
  ).join("");
  resultEl.innerHTML = `
    <div class="banner err">
      <h2>输入校验未通过</h2>
      <p>请修正下列问题后重新联立（行号对应文本框中的原始行号）：</p>
    </div>
    <div class="card"><ul class="plain">${items}</ul></div>`;
}

function renderOk(data) {
  const rows = data.timeline.map((t) =>
    `<tr><td>${esc(t.event)}</td><td class="num">${t.minute}</td></tr>`
  ).join("");

  const maxMinute = Math.max(...data.timeline.map((t) => t.minute));
  const points = data.timeline.map((t) => `
    <div class="tl-point">
      <div class="tl-dot"></div>
      <div class="tl-name">${esc(t.event)}</div>
      <div class="tl-time">第 ${t.minute} 分钟</div>
    </div>`).join("");

  const checks = data.differences.map((d) => {
    const fit = d.low <= d.actual && d.actual <= d.high;
    return `<tr>
      <td class="num">${d.line}</td>
      <td>${esc(d.a)} → ${esc(d.b)}</td>
      <td class="num">[${d.low}, ${d.high}]</td>
      <td class="num">${d.actual}</td>
      <td>${fit ? '<span class="ok-text">满足</span>' : '<span style="color:var(--err)">不满足</span>'}</td>
    </tr>`;
  }).join("");

  const options = data.differences.map((d) =>
    `<option value="${d.line}">第 ${d.line} 行：${esc(d.a)} → ${esc(d.b)} [${d.low}, ${d.high}]</option>`
  ).join("");

  resultEl.innerHTML = `
    <div class="banner ok">
      <h2>✓ 区间无冲突</h2>
      <p>共 ${data.event_count} 个事件、${data.line_count} 条约束；以下时间线以最早事件为第 0 分钟，且满足全部区间。</p>
    </div>
    <div class="card">
      <h3>可行时间线</h3>
      <div class="timeline-track">
        <div class="tl-line"></div>
        <div class="tl-grid">${points}</div>
      </div>
      <table>
        <thead><tr><th>事件</th><th class="num">分钟（最早事件 = 0）</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">时间跨度：0 ~ ${maxMinute} 分钟。所有事件可整体平移，差值不变。</p>
    </div>
    <div class="card">
      <h3>逐条核对</h3>
      <table>
        <thead><tr>
          <th class="num">行号</th><th>事件对</th><th class="num">要求区间</th>
          <th class="num">本时间线差值</th><th>结果</th>
        </tr></thead>
        <tbody>${checks}</tbody>
      </table>
    </div>
    <div class="card">
      <h3>约束冗余核对</h3>
      <p class="muted">
        选择一条原始行，系统会<strong>临时删去该行的上下界约束</strong>，仅用其余约束推导这两个事件
        时间差的最紧区间：推导区间完全落在该行区间内 ⇒ 该行可删（冗余转述）；否则该行必要。
      </p>
      <div class="picker-row">
        <select id="redun-line" aria-label="选择要核对的原始行">${options}</select>
        <button id="btn-redun" class="primary">核对所选行</button>
      </div>
    </div>`;

  $("btn-redun").addEventListener("click", checkRedundancy);
}

function renderConflict(data) {
  const c = data.conflict;
  const steps = c.steps;

  // 链式图：事件节点 + 行号/界值标注，最后回到起点形成闭合环
  const parts = [];
  steps.forEach((s, i) => {
    if (i === 0) parts.push(`<div class="chain-node">${esc(s.from)}</div>`);
    parts.push(`
      <div class="chain-edge">
        <span class="tag ${s.kind}">第 ${s.line} 行 · ${esc(s.kind_label)} ${s.bound}</span>
        <span class="rel">${esc(s.relation)}</span>
        <span class="chain-arrow">→</span>
      </div>
      <div class="chain-node">${esc(s.to)}</div>`);
  });
  parts.push(`
    <div class="chain-edge">
      <span class="muted">闭合回到</span>
      <span class="chain-arrow">⟲</span>
    </div>
    <div class="chain-node">${esc(c.closes_to)}</div>`);

  const detailRows = steps.map((s) => `
    <tr>
      <td class="num">${s.line}</td>
      <td>${esc(s.from)} → ${esc(s.to)}</td>
      <td><span class="tag ${s.kind}">${esc(s.kind_label)}</span></td>
      <td class="num">${s.bound}</td>
      <td>${esc(s.relation)}</td>
    </tr>`).join("");

  resultEl.innerHTML = `
    <div class="banner conflict">
      <h2>✗ 区间存在冲突（闭合矛盾链）</h2>
      <p>下列 ${steps.length} 条原始行首尾相接形成闭合环，环上界值相加为负数
      （<strong>${c.weight_sum} &lt; 0</strong>），即推出“某事件必须早于自己”，无任何时间线可同时满足。</p>
    </div>
    <div class="card">
      <h3>矛盾链</h3>
      <div class="chain">${parts.join("")}</div>
    </div>
    <div class="card">
      <h3>涉及的原始行与上下界</h3>
      <table>
        <thead><tr>
          <th class="num">行号</th><th>图中方向</th><th>使用的界</th>
          <th class="num">界值</th><th>含义</th>
        </tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
      <p class="muted">“上界”取该行最多分钟（事件乙 − 事件甲 ≤ 上界）；“下界”取该行最少分钟（事件乙 − 事件甲 ≥ 下界）。</p>
    </div>`;
}

/* ---------- 约束冗余核对 ---------- */

function fmtBound(v) {
  return v === null || v === undefined ? "无界" : String(v);
}

// 推导区间展示：无界端点用 ±∞ 表示
function fmtInterval(low, high) {
  const l = low === null || low === undefined ? "−∞" : low;
  const h = high === null || high === undefined ? "+∞" : high;
  return `[${l}, ${h}]`;
}

function chainHtml(steps) {
  const parts = [];
  steps.forEach((s, i) => {
    if (i === 0) parts.push(`<div class="chain-node">${esc(s.from)}</div>`);
    parts.push(`
      <div class="chain-edge">
        <span class="tag ${s.kind}">第 ${s.line} 行 · ${esc(s.kind_label)} ${s.bound}</span>
        <span class="rel">${esc(s.relation)}</span>
        <span class="chain-arrow">→</span>
      </div>
      <div class="chain-node">${esc(s.to)}</div>`);
  });
  return `<div class="chain">${parts.join("")}</div>`;
}

function pathTableHtml(steps) {
  const rows = steps.map((s) => `
    <tr>
      <td class="num">${s.line}</td>
      <td>${esc(s.from)} → ${esc(s.to)}</td>
      <td><span class="tag ${s.kind}">${esc(s.kind_label)}</span></td>
      <td class="num">${s.bound}</td>
      <td>${esc(s.relation)}</td>
    </tr>`).join("");
  return `
    <table>
      <thead><tr>
        <th class="num">行号</th><th>图中方向</th><th>使用的界</th>
        <th class="num">界值</th><th>含义</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function pathCardHtml(title, path, emptyNote) {
  if (!path) return "";
  const body = path.steps.length
    ? `${chainHtml(path.steps)}${pathTableHtml(path.steps)}`
    : `<p class="muted">${esc(emptyNote)}</p>`;
  return `
    <div class="card">
      <h3>${esc(title)}</h3>
      ${body}
      <p class="muted">各边权值相加 = ${path.weight_sum} ⇒ ${esc(path.conclusion)}。这是最紧（最短）推导路径，标注为所用原始行号与界值。</p>
    </div>`;
}

function renderRedundancy(r) {
  const removable = r.verdict === "removable";
  const interval = fmtInterval(r.derived_low, r.derived_high);

  const reasons = [];
  if (!r.low_covered) {
    reasons.push(r.derived_low === null
      ? "下界无界：其余约束无法限制这两个事件至少相隔多久"
      : `推导下界 ${r.derived_low} 小于该行下界 ${r.low}`);
  }
  if (!r.high_covered) {
    reasons.push(r.derived_high === null
      ? "上界无界：其余约束无法限制这两个事件至多相隔多久"
      : `推导上界 ${r.derived_high} 大于该行上界 ${r.high}`);
  }

  const banner = removable
    ? `<div class="banner ok">
         <h2>✓ 第 ${r.line} 行可删（冗余约束）</h2>
         <p>删去该行后，其余 ${r.rest_line_count} 条约束仍必然推出
         <strong>${esc(r.b)} − ${esc(r.a)} ∈ ${interval}</strong>，
         完全落在该行区间 [${r.low}, ${r.high}] 内，删去它不丢失任何信息。</p>
       </div>`
    : `<div class="banner conflict">
         <h2>✗ 第 ${r.line} 行必要（不可删）</h2>
         <p>删去该行后，其余 ${r.rest_line_count} 条约束只能推出
         <strong>${esc(r.b)} − ${esc(r.a)} ∈ ${interval}</strong>，
         未完全落在该行区间 [${r.low}, ${r.high}] 内：${reasons.map(esc).join("；")}。</p>
       </div>`;

  const cover = (ok) => ok
    ? '<span class="ok-text">✓ 被覆盖</span>'
    : '<span style="color:var(--err)">✗ 未被覆盖</span>';

  const upperCard = r.derived_high === null
    ? `<div class="card">
         <h3>上界推导：无界</h3>
         <p class="muted">删去该行后，其余约束从「${esc(r.a)}」到「${esc(r.b)}」不可达，
         无法给出 ${esc(r.b)} − ${esc(r.a)} 的上限。</p>
       </div>`
    : pathCardHtml(
        `上界推导路径（${r.b} − ${r.a} ≤ ${r.derived_high}）`,
        r.upper_path,
        "同一事件，差值恒为 0，无需其他约束。",
      );

  const lowerCard = r.derived_low === null
    ? `<div class="card">
         <h3>下界推导：无界</h3>
         <p class="muted">删去该行后，其余约束从「${esc(r.b)}」到「${esc(r.a)}」不可达，
         无法给出 ${esc(r.b)} − ${esc(r.a)} 的下限。</p>
       </div>`
    : pathCardHtml(
        `下界推导路径（${r.b} − ${r.a} ≥ ${r.derived_low}）`,
        r.lower_path,
        "同一事件，差值恒为 0，无需其他约束。",
      );

  redundancyEl.innerHTML = `
    ${banner}
    <div class="card">
      <h3>推导区间 vs 第 ${r.line} 行区间</h3>
      <table>
        <thead><tr>
          <th>端点</th><th class="num">其余约束推导</th>
          <th class="num">该行要求</th><th>覆盖判定</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>下界（${esc(r.b)} − ${esc(r.a)} ≥ …）</td>
            <td class="num">${fmtBound(r.derived_low)}</td>
            <td class="num">≥ ${r.low}</td>
            <td>${cover(r.low_covered)}</td>
          </tr>
          <tr>
            <td>上界（${esc(r.b)} − ${esc(r.a)} ≤ …）</td>
            <td class="num">${fmtBound(r.derived_high)}</td>
            <td class="num">≤ ${r.high}</td>
            <td>${cover(r.high_covered)}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">判定规则：仅当推导区间 ${interval} 完全落在第 ${r.line} 行区间
      [${r.low}, ${r.high}] 内（两个端点都被覆盖）才判为“可删”。</p>
    </div>
    ${upperCard}
    ${lowerCard}`;

  redundancyEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function checkRedundancy() {
  const select = $("redun-line");
  if (!select || !select.value) return;
  const line = parseInt(select.value, 10);
  redundancyEl.innerHTML = `<div class="card muted">核对中…</div>`;
  try {
    const resp = await fetch("/api/redundancy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inputEl.value, line }),
    });
    const data = await resp.json();
    if (data.status === "ok" && data.redundancy) {
      renderRedundancy(data.redundancy);
    } else {
      // 输入无效或原约束冲突：沿用现有求解结果的展示
      redundancyEl.innerHTML = "";
      if (data.status === "conflict") renderConflict(data);
      else renderErrors(data.errors || [{ line: null, message: "未知错误。" }]);
    }
  } catch (err) {
    redundancyEl.innerHTML = `
      <div class="banner err"><h2>请求失败</h2><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------- 联立求解 ---------- */

async function solve() {
  const text = inputEl.value;
  redundancyEl.innerHTML = "";
  resultEl.innerHTML = `<div class="card muted">联立中…</div>`;
  try {
    const resp = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    if (data.status === "ok") renderOk(data);
    else if (data.status === "conflict") renderConflict(data);
    else renderErrors(data.errors || [{ line: null, message: "未知错误。" }]);
  } catch (err) {
    resultEl.innerHTML = `
      <div class="banner err"><h2>请求失败</h2><p>${esc(err.message)}</p></div>`;
  }
}

$("btn-solve").addEventListener("click", solve);
$("btn-example-ok").addEventListener("click", () => {
  inputEl.value = EXAMPLE_OK;
  solve();
});
$("btn-example-conflict").addEventListener("click", () => {
  inputEl.value = EXAMPLE_CONFLICT;
  solve();
});
$("btn-clear").addEventListener("click", () => {
  inputEl.value = "";
  resultEl.innerHTML = "";
  redundancyEl.innerHTML = "";
  inputEl.focus();
});
