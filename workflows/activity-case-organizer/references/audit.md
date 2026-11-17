# 全站体检

只读：扫服务器上每场活动的原始记录，用 `scripts/checks.py` 列出问题。不下载图片视频、不写服务器，几十场一两分钟。需要本机部署身份（读原始记录要团队白名单），先过 SKILL.md「开工自检」第 1 步。

```bash
python3 "$SKILL/scripts/audit.py" --csv 体检.csv                       # 正式站
python3 "$SKILL/scripts/audit.py" --csv 体检.csv --waivers 体检豁免.json  # 跳过已豁免的
```

打印按问题类型和按活动的汇总；`--csv` 写逐条清单（Excel 可直接打开），列：活动、uid、问题代码、规则、对象、说明。

## 规则（`checks.RULES`）

| 代码 | 意思 | 怎么修 |
| --- | --- | --- |
| summary-missing / summary-template / summary-too-long | 活动简介空、是「××活动资料与成员作品归档」模板句、超过 20 字 | repair `summary` |
| case-intro-missing / case-intro-too-long | 案例简介空或超过 15 字 | repair `case-intro`，长内容放 `detail` |
| work-video-in-activity | 名字含「作品视频」的视频在活动视频区 | repair `video-to-case` |
| video-no-poster / case-video-no-poster | 视频没有封面 | repair `posters` |
| video-raw-title | 视频标题会显示成「活动视频_xx」 | repair `titles` |
| asset-no-url | 记录里的素材在图床没有地址 | 查原因，通常要重传 |

旧格式案例没有 `说明.md` 文字（readme 为空）时不判简介，避免误报。

## 规则不适用怎么办

不改规则，写豁免。豁免文件是一个列表，每条必须写理由，没理由的豁免会报错：

```json
[{"uid": "2026-xx-xx_某活动", "code": "summary-too-long", "reason": "主办方要求的完整名称"},
 {"uid": "2026-xx-xx_某活动", "code": "video-no-poster", "target": "01_活动照片/xx.mp4", "reason": "纯音频，没有画面"}]
```

`target` 省略 = 这场这类问题都豁免。豁免和体检清单一起交给使用者看，不能为了让清单变短而豁免。

## 什么时候跑

- 批量修之前跑一次，把清单发给使用者，按他定的优先级分批修。
- 每次上线（新活动或修复）后跑一次，确认问题总数没有变多。
- 改了 `checks.py` 的规则后跑一次：新规则可能让旧活动一下多出很多条，要先和使用者说清楚，再决定是批量修还是建豁免。
