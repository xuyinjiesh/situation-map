# 候选数据投放目录

Phase 2 的采集器把候选条目写到这里，**不要直接改 `src/data/`**。

```bash
# 校验但不写入
node scripts/pipeline.mjs --check data/raw/events.candidate.json --kind events

# 校验通过后写入 src/data/，原文件备份为 events.json.bak，并 bump 数据集版本
node scripts/pipeline.mjs --promote data/raw/events.candidate.json --kind events
```

文件格式就是 `src/data/events.json` / `src/data/trends.json` 的数组格式，
唯一放宽的是 `places` / `corridor` 里的坐标可以省略 —— 会由 `data/gazetteer.json` 补全。
地名册里查不到的地名会被判为错误，请先把它加进地名册。
