#!/bin/bash
# Emergency Rollback

echo "EMERGENCY ROLLBACK"
echo "1=Config Kill 2=Vercel Rollback 3=Git Revert"
read -p "Choice: " CHOICE

case $CHOICE in
  1) read -p "Detector: " D; curl -X PUT "https://robot-detect-v3.vercel.app/api/horizon/config/freeze" -H "Content-Type: application/json" -d "{\"detector\":\"$D\"}"; echo "Done";;
  2) vercel rollback --prod --yes; echo "Done";;
  3) git revert --no-commit $(git log --oneline -1 | cut -d' ' -f1) && git commit -m "revert" && git push; echo "Done";;
esac