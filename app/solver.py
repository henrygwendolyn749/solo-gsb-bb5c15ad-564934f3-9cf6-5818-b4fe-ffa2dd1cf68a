"""差分约束求解：联立事件时间差区间，检测矛盾、给出可行时间线，并核对单条约束是否冗余。

每条输入行：事件甲, 事件乙, 最少分钟 lo, 最多分钟 hi
含义：lo <= t(乙) - t(甲) <= hi

改写为标准差分约束（最短路）形式：
    t(乙) - t(甲) <= hi        -> 边 甲 -> 乙，权 hi（上界）
    t(甲) - t(乙) <= -lo       -> 边 乙 -> 甲，权 -lo（下界）

引入指向所有事件、权为 0 的虚拟源（实现上等价于把所有距离初始化为 0），
用 Bellman-Ford 判定：第 N 轮仍可松弛 => 存在负环，即区间互相矛盾。

约束冗余核对：删去所选行的两条边后（原系统一致，删边不会产生负环），
    t(乙) - t(甲) 的最紧上界 = 甲 -> 乙 的最短路长度；
    t(乙) - t(甲) 的最紧下界 = -(乙 -> 甲 的最短路长度)。
端点不可达即该端无界。推导区间完全落入所选行区间 => 该行可删（冗余），否则必要。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_INT_RE = re.compile(r"^[+-]?\d+$")


@dataclass(frozen=True)
class Row:
    line: int
    a: str
    b: str
    low: int
    high: int


@dataclass(frozen=True)
class Edge:
    u: int
    v: int
    w: int
    line: int
    kind: str  # "upper"（上界边）或 "lower"（下界边）
    bound: int  # 原始行中的界值（上界为 high，下界为 low）


def _parse_int(token: str, field: str, line: int) -> tuple[int | None, str | None]:
    if not _INT_RE.match(token):
        return None, f"第{line}行：{field}必须是整数分钟，得到 “{token}”"
    return int(token), None


def parse_text(text: str) -> tuple[list[Row], list[dict]]:
    """按行解析与校验。返回 (有效行, 错误列表)。"""
    errors: list[dict] = []
    rows: list[Row] = []

    if not text or not text.strip():
        return rows, [{"line": None, "message": "输入为空：请粘贴“事件甲,事件乙,最少分钟,最多分钟”格式的多行文本。"}]

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue  # 空行不计入校验，但行号保留为原始行号

        # 兼容中文逗号
        parts = [p.strip() for p in line.replace("，", ",").split(",")]
        if len(parts) != 4:
            errors.append({
                "line": line_no,
                "message": f"第{line_no}行：应为 4 个字段（事件甲,事件乙,最少分钟,最多分钟），实际得到 {len(parts)} 个。",
            })
            continue

        a, b, low_s, high_s = parts
        row_errors: list[str] = []
        if not a:
            row_errors.append("事件甲名称为空")
        if not b:
            row_errors.append("事件乙名称为空")

        low, err_low = _parse_int(low_s, "最少分钟", line_no)
        high, err_high = _parse_int(high_s, "最多分钟", line_no)
        if err_low:
            row_errors.append(err_low.split("：", 1)[1])
        if err_high:
            row_errors.append(err_high.split("：", 1)[1])

        if low is not None and high is not None and low > high:
            row_errors.append(f"下界 {low} 大于上界 {high}，时间差区间为空")

        if row_errors:
            errors.append({"line": line_no, "message": f"第{line_no}行：" + "；".join(row_errors) + "。"})
            continue

        rows.append(Row(line_no, a, b, low, high))  # type: ignore[arg-type]

    return rows, errors


def _build_graph(rows: list[Row]) -> tuple[list[str], dict[str, int], list[Edge]]:
    """事件按首次出现顺序编号，每行展开为上/下界两条边。"""
    names: list[str] = []
    index: dict[str, int] = {}
    for r in rows:
        for name in (r.a, r.b):
            if name not in index:
                index[name] = len(names)
                names.append(name)

    edges: list[Edge] = []
    for r in rows:
        ia, ib = index[r.a], index[r.b]
        edges.append(Edge(ia, ib, r.high, r.line, "upper", r.high))
        edges.append(Edge(ib, ia, -r.low, r.line, "lower", r.low))
    return names, index, edges


def _bellman_ford(n: int, edges: list[Edge]) -> tuple[list[int], list, int | None]:
    """虚拟源（所有距离初始化为 0）Bellman-Ford。

    返回 (dist, pred, 第 N 轮仍被松弛的顶点)；后者非 None 即存在负环。
    """
    dist = [0] * n
    pred: list[tuple[int, Edge] | None] = [None] * n
    last_relaxed: int | None = None

    for iteration in range(n):
        relaxed = False
        for e in edges:
            cand = dist[e.u] + e.w
            if cand < dist[e.v]:
                dist[e.v] = cand
                pred[e.v] = (e.u, e)
                relaxed = True
                if iteration == n - 1:
                    last_relaxed = e.v
        if not relaxed:
            break
    return dist, pred, last_relaxed


def _shortest_paths_from(n: int, edges: list[Edge], source: int) -> tuple[list[int | None], list]:
    """单源最短路（无虚拟源），不可达顶点距离为 None。调用前提：图中无负环。"""
    dist: list[int | None] = [None] * n
    dist[source] = 0
    pred: list[tuple[int, Edge] | None] = [None] * n

    for _ in range(n - 1):
        relaxed = False
        for e in edges:
            du = dist[e.u]
            if du is None:
                continue
            cand = du + e.w
            if dist[e.v] is None or cand < dist[e.v]:
                dist[e.v] = cand
                pred[e.v] = (e.u, e)
                relaxed = True
        if not relaxed:
            break
    return dist, pred


def _path_edges(pred: list, source: int, target: int) -> list[Edge] | None:
    """沿前驱指针还原 source -> target 的最短路（边序列，正向）；不可达返回 None。"""
    if source == target:
        return []
    path: list[Edge] = []
    cur = target
    while cur != source:
        step = pred[cur]
        if step is None:
            return None
        pu, e = step
        path.append(e)
        cur = pu
    path.reverse()
    return path


def _edge_step(names: list[str], e: Edge) -> dict:
    """把一条边翻译回原始行号、界值与人读的关系式。"""
    if e.kind == "upper":
        relation = f"{names[e.v]}−{names[e.u]} ≤ {e.bound}"
        kind_label = "上界（最多）"
    else:
        # 边 v -> u、权 -low 对应 names[v]−names[u] >= low，即 u 事件比 v 事件早至少 low
        relation = f"{names[e.u]}−{names[e.v]} ≥ {e.bound}"
        kind_label = "下界（最少）"
    return {
        "from": names[e.u],
        "to": names[e.v],
        "weight": e.w,
        "line": e.line,
        "kind": e.kind,
        "kind_label": kind_label,
        "bound": e.bound,
        "relation": relation,
    }


def solve(text: str) -> dict:
    rows, errors = parse_text(text)
    if errors:
        return {"status": "error", "errors": errors}

    if not rows:
        return {
            "status": "error",
            "errors": [{"line": None, "message": "没有可联立的有效约束行。"}],
        }

    names, index, edges = _build_graph(rows)
    n = len(names)
    dist, pred, last_relaxed = _bellman_ford(n, edges)

    if last_relaxed is not None:
        return _conflict_result(names, pred, last_relaxed, n)

    # 平移使最早事件落在第 0 分钟（差值不变，约束全部保留）
    base = min(dist)
    timeline = [
        {"event": names[i], "minute": dist[i] - base}
        for i in range(n)
    ]
    timeline.sort(key=lambda x: (x["minute"], x["event"]))

    differences = [
        {
            "line": r.line,
            "a": r.a,
            "b": r.b,
            "low": r.low,
            "high": r.high,
            "actual": dist[index[r.b]] - dist[index[r.a]],
        }
        for r in rows
    ]

    return {
        "status": "ok",
        "timeline": timeline,
        "differences": differences,
        "event_count": n,
        "line_count": len(rows),
    }


def check_redundancy(text: str, line: int) -> dict:
    """约束冗余核对：删去第 line 行后，考察其余约束是否仍必然满足该行的时间差区间。

    输入无效或原约束冲突时，返回与 solve() 相同的结果（沿用现有求解结果）。
    """
    rows, errors = parse_text(text)
    if errors:
        return {"status": "error", "errors": errors}

    if not rows:
        return {
            "status": "error",
            "errors": [{"line": None, "message": "没有可联立的有效约束行。"}],
        }

    names, index, edges = _build_graph(rows)
    n = len(names)

    # 原约束本身冲突：沿用现有求解结果（闭合矛盾链），不做冗余核对
    _, pred, last_relaxed = _bellman_ford(n, edges)
    if last_relaxed is not None:
        return _conflict_result(names, pred, last_relaxed, n)

    if line < 1:
        return {
            "status": "error",
            "errors": [{"line": None, "message": "请提供正整数的原始行号。"}],
        }

    target = next((r for r in rows if r.line == line), None)
    if target is None:
        return {
            "status": "error",
            "errors": [{
                "line": line,
                "message": f"第{line}行不是可核对的约束行（空行或校验未通过的行不参与联立）。",
            }],
        }

    ia, ib = index[target.a], index[target.b]
    # 同时移除该行对应的上、下界两条约束
    rest = [e for e in edges if e.line != target.line]

    # 最紧上界：甲 -> 乙 最短路；最紧下界：-(乙 -> 甲 最短路)
    dist_ab, pred_ab = _shortest_paths_from(n, rest, ia)
    dist_ba, pred_ba = _shortest_paths_from(n, rest, ib)

    upper = dist_ab[ib]
    lower = -dist_ba[ia] if dist_ba[ia] is not None else None

    upper_path = None
    if upper is not None:
        path = _path_edges(pred_ab, ia, ib) or []
        upper_path = {
            "from": target.a,
            "to": target.b,
            "steps": [_edge_step(names, e) for e in path],
            "weight_sum": sum(e.w for e in path),
            "conclusion": f"{target.b}−{target.a} ≤ {upper}",
        }

    lower_path = None
    if lower is not None:
        path = _path_edges(pred_ba, ib, ia) or []
        total = sum(e.w for e in path)
        lower_path = {
            "from": target.b,
            "to": target.a,
            "steps": [_edge_step(names, e) for e in path],
            "weight_sum": total,
            "conclusion": f"{target.a}−{target.b} ≤ {total}，即 {target.b}−{target.a} ≥ {lower}",
        }

    # 端点被覆盖：其余约束推出的端点不弱于该行自己的界
    low_covered = lower is not None and lower >= target.low
    high_covered = upper is not None and upper <= target.high
    removable = low_covered and high_covered

    return {
        "status": "ok",
        "redundancy": {
            "line": target.line,
            "a": target.a,
            "b": target.b,
            "low": target.low,
            "high": target.high,
            "derived_low": lower,
            "derived_high": upper,
            "low_covered": low_covered,
            "high_covered": high_covered,
            "verdict": "removable" if removable else "necessary",
            "upper_path": upper_path,
            "lower_path": lower_path,
            "event_count": n,
            "line_count": len(rows),
            "rest_line_count": len(rows) - 1,
        },
    }


def _conflict_result(names: list[str], pred, start: int, n: int) -> dict:
    """从第 N 轮仍被松弛的顶点出发，沿前驱找回负环并还原为原始行构成的矛盾链。"""
    x = start
    for _ in range(n):
        step = pred[x]
        if step is None:
            break
        x = step[0]

    cycle_edges: list[tuple[int, Edge]] = []
    seen: set[int] = set()
    cur = x
    while cur not in seen:
        seen.add(cur)
        step = pred[cur]
        if step is None:
            break
        pu, e = step
        cycle_edges.append((pu, e))
        cur = pu

    # 沿前驱收集是逆序的，翻转回边的正向（u -> v）
    cycle_edges.reverse()

    steps = [_edge_step(names, e) for _, e in cycle_edges]

    total = sum(s["weight"] for s in steps)
    return {
        "status": "conflict",
        "conflict": {
            "steps": steps,
            "weight_sum": total,
            "closes_to": steps[0]["from"] if steps else None,
        },
    }
