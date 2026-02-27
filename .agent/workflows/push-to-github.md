---
description: Push code changes to GitHub after editing
---

After making code changes, always commit and push to GitHub:

// turbo-all

1. Stage all changes:
```
$env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH; git -C "c:\Users\PC\Documents\Lightshot\video-planner" add -A
```

2. Commit with a descriptive message:
```
$env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH; git -C "c:\Users\PC\Documents\Lightshot\video-planner" commit -m "<descriptive commit message>"
```

3. Push to GitHub:
```
$env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH; git -C "c:\Users\PC\Documents\Lightshot\video-planner" push origin main
```
