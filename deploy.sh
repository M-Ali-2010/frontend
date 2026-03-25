#!/bin/bash

echo "🚀 STARTING AUTO DEPLOY..."

# -----------------------------
# 1. CLEAN PROJECT
# -----------------------------
echo "🧹 Cleaning..."

rm -rf backend/node_modules
rm -f backend/.env

echo "✅ Clean done"

# -----------------------------
# 2. INIT GIT (if needed)
# -----------------------------
if [ ! -d ".git" ]; then
  echo "📦 Init git..."
  git init
  git add .
  git commit -m "initial commit"
fi

# -----------------------------
# 3. ADD REMOTE (if not exists)
# -----------------------------
if ! git remote | grep origin > /dev/null; then
  echo "🌐 Add your GitHub repo manually!"
  echo "👉 git remote add origin https://github.com/USERNAME/REPO.git"
  exit 1
fi

# -----------------------------
# 4. PUSH TO GITHUB
# -----------------------------
echo "📤 Pushing to GitHub..."
git add .
git commit -m "deploy update"
git push origin main

echo "✅ Code pushed"

# -----------------------------
# 5. FINAL INSTRUCTIONS
# -----------------------------
echo ""
echo "🔥 NOW DO THIS:"
echo ""
echo "1. Render → New Web Service"
echo "   Root: backend"
echo "   Start: node server.js"
echo ""
echo "2. Add ENV:"
echo "   MONGODB_URI=..."
echo "   CORS_ORIGIN=https://your-vercel.app"
echo "   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com"
echo "   PLATFORM_WALLET_ADDRESS=..."
echo ""
echo "3. Vercel → Deploy frontend"
echo ""
echo "4. Replace URLs in frontend:"
echo "   io('https://your-backend.onrender.com')"
echo ""
echo "💀 DONE"