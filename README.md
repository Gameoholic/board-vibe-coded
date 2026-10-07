To pull and update changes:
```
cd /opt/board-vibe-coded
git pull
pnpm build
pm2 restart board-api
```

Future ideas:

- Have a way to mark important tasks in red. Or even better, have (optional) priority for tasks, sorted like this: High -> Medium -> Unspecified -> Low. Will be both an optional display (off by default), but primarily will show up in the 'manual' sort option. create a claude artifact to preview the different things we could do: Maybe group them by priority or mayeb not, maybe show how many tasks are in each priority, maybe not, maybe say the actual priority in the display or make it just icons or colors or emojis... Make as many different options, make a builder actually in the artifact that lets me play around with all the different optiosn and make combinations so i can find the design i like best.
