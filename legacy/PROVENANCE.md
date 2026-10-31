# 存证

本目录文件为原样拷贝，未作任何修改，用于在 `kunpengzhi-ai` 服务端修复前保全源码。

| 文件 | 原路径 | 原 commit | SHA-256 |
| :--- | :--- | :--- | :--- |
| `spiral-engine.js` | `public/spiral-notation/spiral-engine.js` | `d48aa7c` | `2d52b90100f0d0880ccc6e7ac90d4d9887166e343716f268cb10f492f9132264` |
| `index.html` | `public/spiral-notation/index.html` | `d48aa7c` | `2f40139d8b78b7120d354aee34c2b5752be392371216109f829436a1986cf59c` |
| `spiral-notation-archimedean.html` | `public/spiral-notation.html`（改名为避免与 `index.html` 混淆） | `d48aa7c` | `be82afef24a34f2757c3fbeb64713ace398ba976e1c16227d09c25c5a68e29a0` |

- 来源检出：`~/projects/gitea/kunpengzhi-ai`（`dev`，HEAD `d48aa7c`，工作区干净），与 `~/projects/github/kunpengzhi-ai` 的 `public/spiral-notation/` 逐字节一致。
- 引入历史：`50be88d`（引擎 + 演示页）、`f7c5a21`（阿基米德单页）、`ee8233a`（index.html 并入）。
- 未随迁：论文引用的 `midi/12et.py` 属洛浦项目，不在 `kunpengzhi-ai` 内，本仓库未持有该文件。
- 服务端：`https://gitea.capitaltrain.cn/api/v1/repos/seekkey/kunpengzhi-ai` 及 `git clone` 均返回 500（2026-10-31 实测）。
