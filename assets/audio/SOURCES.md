# 音频素材来源（YWQ-AUDIO-01）

| 文件 | 用途 | 生成 |
|------|------|------|
| `ambient_loop.mp3` | 房间环境底噪（循环） | MiniMax Design `design music` → `ambient_room.mp3` 裁 45s |
| `caught_sting.mp3` | 被抓冲击 + 前 0.22s 静音感 | Design music `caught_sting` 裁前 2.8s |
| `footstep.mp3` | 门外脚步单步 | Design music `footstep_one` 裁 0.35s + EQ |
| `door.mp3` | 门开 | `door_raw` 裁 1.6s |
| `page.mp3` | 翻线索纸 | `page_raw` 裁 0.22s |
| `tv_loop.mp3` | 看电视时段 CRT 底噪 | `tv_raw` 裁 12s 循环 |
| `parent_warn.mp3` | 检查预警低语 | Design speech |
| `handle.mp3` | 门外拧门把 | `door.mp3` 裁切 + EQ |
| `safe.mp3` | 检查结束松一口气 | ffmpeg 双音 chime |
| `breath.mp3` | 违规被看见时鼻息 | ffmpeg 粉噪 |
| `clock_tick.mp3` | 调台钟咔哒 | ffmpeg 短 sine |
| `escaped.mp3` | 逃出楼道感 | `door.mp3` + echo 裁 3.2s |
| `parent_caught_*.mp3` | 家长台词（按 duty / 读纸） | Design `speech` 中文 |
| `parent_time_ok/early/clock_suspicious.mp3` | 看钟台词（到点/还早/你动过钟） | 2026-10-22 交付包 |
| `voice/yq_parent_*.mp3` | 27 句家长变体（进池规则见 `DELIVERY-20261022.md`） | 2026-10-22 交付包 |

2026-10-22 起，上表前 18 个 mp3 已换成 48 kHz 母版；变体池与未进池句子的听校记录在 `DELIVERY-20261022.md`。

原始长文件在 `tools/audio-out/`；重新生成后运行：

```bash
# 示例（需 MiniMax Design.app 已开）
design doctor
design music "…" --instrumental -o tools/audio-out --name ambient_room
ffmpeg -i tools/audio-out/ambient_room.mp3 -t 45 -af "volume=0.55" src/assets/audio/ambient_loop.mp3
```

逻辑回退：若 MP3 加载失败，`src/game/sfx.js` 仍用 WebAudio 噪声/振荡器。
