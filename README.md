# Synesthesia Canvas｜通感画布

一个把图形实时翻译成日系 Complextro 的浏览器乐器。无需外部采样或账户，绘制、播放、分享和 WAV 导出全部在本地完成。

## 核心映射

- X 位置 → 触发时间与立体声声像
- Y 位置 → 吸附到当前音阶的音高
- 图形宽度 → 音符时值
- 图形大小 → 力度
- 画笔 → Neon Brass、Pixel Organ、Glass Keys、Circuit Drums、Sakura Strings 五种合成音色

默认使用 E Hirajoshi、132 BPM、1/16 量化与 swing，并在混音链中加入碎拍、延迟、压缩和鼓组 ducking。

## 操作

- `V` 选择/移动
- `B` 连续绘制
- `S` 图形印章；拖拽可改变音长与力度
- `E` 擦除
- `Space` 播放/停止
- `Cmd/Ctrl + Z` 撤销

作品会自动保存在当前设备。分享按钮会把可恢复的工程数据写入 URL，导出按钮使用 `OfflineAudioContext` 生成 44.1 kHz 立体声 PCM WAV。
