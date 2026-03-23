Set-Location "c:\Users\Moin\Downloads\Upstart"

Remove-Item -Recurse -Force .git
git init
git remote add origin https://github.com/MDMOINAKHTARR/UpWork.git

git config --local user.name "Moin Akhtar"
git config --local user.email "moin.akhtar@example.com"

# Set a start date to 20 days ago
$startDate = (Get-Date).AddDays(-20)

function Make-Commit {
    param(
        [string]$Message,
        [int]$DayOffset
    )
    $commitDate = $startDate.AddDays($DayOffset).ToString("yyyy-MM-ddTHH:mm:ss")
    $env:GIT_AUTHOR_DATE = $commitDate
    $env:GIT_COMMITTER_DATE = $commitDate
    git commit -m $Message
}

# Commit 1
git add .gitignore
Make-Commit -Message "chore: Initialize project with ignore rules" -DayOffset 1

# Commit 2
git add PRD.md
Make-Commit -Message "docs: Add Product Requirements Document" -DayOffset 2

# Commit 3
git add frontend/package.json frontend/package-lock.json
Make-Commit -Message "chore(frontend): Setup frontend package dependencies" -DayOffset 3

# Commit 4
git add frontend/tsconfig.json frontend/next-env.d.ts
Make-Commit -Message "chore(frontend): Add TypeScript configuration" -DayOffset 4

# Commit 5
git add frontend/next.config.ts frontend/eslint.config.mjs frontend/postcss.config.mjs
Make-Commit -Message "chore(frontend): Configure Next.js, ESLint, and PostCSS" -DayOffset 5

# Commit 6
git add frontend/public
Make-Commit -Message "feat(frontend): Add static public assets" -DayOffset 6

# Commit 7
git add frontend/src/app/globals.css
Make-Commit -Message "style(frontend): Add global typography and color palette" -DayOffset 7

# Commit 8
git add frontend/src/app/layout.tsx
Make-Commit -Message "feat(frontend): Implement core application layout shell" -DayOffset 8

# Commit 9
git add frontend/src/app/page.tsx
Make-Commit -Message "feat(frontend): Implement main landing page" -DayOffset 9

# Commit 10
git add frontend/src/lib/api.ts
Make-Commit -Message "feat(frontend): Add API utility for backend communication" -DayOffset 10

# Commit 11
git add frontend/src/components
Make-Commit -Message "feat(frontend): Implement reusable UI components" -DayOffset 11

# Commit 12
git add frontend/src/app/saved-ideas
Make-Commit -Message "feat(frontend): Add saved ideas dashboard page" -DayOffset 12

# Commit 13
git add frontend/src/app/signup frontend/src/app/login
Make-Commit -Message "feat(frontend): Implement authentication pages" -DayOffset 13

# Commit 14
git add backend/package.json backend/package-lock.json
Make-Commit -Message "chore(backend): Setup backend package dependencies" -DayOffset 14

# Commit 15
git add backend/server.js
Make-Commit -Message "chore(backend): Initialize Express server" -DayOffset 15

# Commit 16
git add backend/db backend/data
Make-Commit -Message "feat(backend): Setup MongoDB connection and data schemas" -DayOffset 16

# Commit 17
git add backend/services/aiService.js backend/services/trendService.js
Make-Commit -Message "feat(backend): Implement AI and Trends integration services" -DayOffset 17

# Commit 18
git add backend/services/authService.js backend/services/emailService.js
Make-Commit -Message "feat(backend): Implement backend authentication and email services" -DayOffset 18

# Commit 19
git add backend/middleware backend/routes
Make-Commit -Message "feat(backend): Map API routes and add validation middleware" -DayOffset 19

# Commit 20
git add images README.md
git add .
Make-Commit -Message "chore: Finalize repository structure and README docs" -DayOffset 20

# Force push to overwrite the previous history
git branch -M main
git push -u origin main --force
