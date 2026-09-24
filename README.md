# 口述史事件时间线核对

供口述史整理者核对多个事件“先后描述”是否自洽的小工具。整理者把访谈中得到的两事件时间差区间逐行粘贴，后端把全部区间联立为**差分约束系统**：

- 若约束互相矛盾，返回一条由**原始行号与对应上下界**构成的**闭合矛盾链**（负环），说明是哪几句话“打了架”；
- 若无矛盾，返回一条以**最早事件为第 0 分钟**、满足全部区间的可行时间线，并逐条核对每个区间。

技术栈：Python 3.11 + FastAPI + 原生 JavaScript（无前端构建、无 npm）。

## 输入格式

每行一条：

```
事件甲,事件乙,最少分钟,最多分钟
```

含义：`最少分钟 ≤ 事件乙时刻 − 事件甲时刻 ≤ 最多分钟`（即“乙比甲晚”的时间差区间，分钟为整数；允许负数表示乙实际更早）。

- 支持半角 `,` 与中文逗号 `，`；
- 空行会被跳过，但**行号按原始文本计算**，矛盾链与错误提示引用的都是原始行号；
- 每行校验：事件名非空、上下界为整数、下界不大于上界。

示例（无冲突）：

```
起床,洗漱,10,30
洗漱,早饭,15,45
早饭,出门,20,60
出门,开会,40,90
起床,开会,80,240
```

页面上可一键填充“可行示例”与“矛盾示例”。

## 单条启动命令（Docker Compose）

```bash
docker compose up -d --build
```

启动后打开浏览器访问：

**http://localhost:8080**

> 页面地址与端口固定为 **8080**。如宿主机 8080 被占用，修改 `compose.yaml` 中 `ports` 的左侧值（如 `"9090:8080"`）即可，容器内端口保持 8080。

停止：

```bash
docker compose down
```

查看日志：

```bash
docker compose logs -f
```

## 不用 Compose 的等价启动方式

```bash
docker build -t oral-history-timeline .
docker run -d --name oral-history-timeline -p 8080:8080 oral-history-timeline
```

## 本地开发运行（不使用容器）

需要 Python 3.11+：

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## 必要配置（环境变量）

均为可选项，默认值即可正常使用：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `8080` | 服务监听端口（容器内固定暴露 8080） |

## 原理简介

对每行 `甲,乙,lo,hi` 建立两条最短路约束：

- `t乙 − t甲 ≤ hi`：边 `甲 → 乙`，权 `hi`（上界）
- `t甲 − t乙 ≤ −lo`：边 `乙 → 甲`，权 `−lo`（下界）

再加一个指向所有事件、权为 0 的虚拟源（实现上等价于所有距离初始化为 0），运行 Bellman-Ford：

- 第 N 轮仍能松弛 ⇒ 存在负环，沿前驱指针还原负环，并映射回每条边的**原始行号与上/下界值**，即页面展示的闭合矛盾链（环上权值之和 < 0，意味着推出 `0 < 0` 式的矛盾）；
- 否则得到一组可行时刻，整体平移令最小值为 0，即为“最早事件在第 0 分钟”的时间线。

## API

- `GET /` — 页面
- `GET /api/health` — 健康检查
- `POST /api/solve` — 请求体 `{"text": "甲,乙,30,60\n..."}`，返回：
  - `status: "ok"`：`timeline`（事件与分钟）、`differences`（逐条核对）；
  - `status: "conflict"`：`conflict.steps`（矛盾链每一环的行号、方向、上/下界与含义）；
  - `status: "error"`：`errors`（逐行校验错误，含原始行号）。

## 项目结构

```
.
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI 入口
│   └── solver.py        # 解析、校验、Bellman-Ford 联立与矛盾链还原
├── static/
│   ├── index.html
│   ├── app.js           # 原生 JS
│   └── style.css
├── Dockerfile
├── compose.yaml
├── docker-entrypoint.sh
└── requirements.txt
```
