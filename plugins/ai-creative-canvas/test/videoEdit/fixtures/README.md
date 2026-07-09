# videoEdit 集成测试素材

本目录不提交大体积媒体文件。运行集成脚本前，在本机用 ffmpeg 生成：

```bash
# 横屏 CFR 3s（含音轨）
ffmpeg -y -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac landscape.mp4

# 竖屏带 rotation 元数据
ffmpeg -y -f lavfi -i testsrc=duration=3:size=1080x1920:rate=30 -c:v libx264 -pix_fmt yuv420p -metadata:s:v:0 rotate=90 portrait.mp4

# 透明 webm
ffmpeg -y -f lavfi -i color=c=green@0.5:s=640x360:d=2 -c:v libvpx-vp9 -pix_fmt yuva420p alpha.webm

# 占位 PNG（文字叠加）
ffmpeg -y -f lavfi -i color=c=white:s=400x80:d=1 -frames:v 1 overlay.png
```

然后执行：`node test/videoEdit/run-export.mjs`
