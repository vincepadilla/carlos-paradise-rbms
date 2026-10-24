<<<<<<< HEAD
# Carlos Paradise RBMS — GitHub Workflow Guide

## 1. Pull Latest Changes Before Working

Always pull the latest changes from `develop` before starting your work.

```bash
# Switch to develop
git switch develop

# Pull the latest changes from GitHub
git pull origin develop

# Switch to your feature branch
git switch feature/login

# Merge the latest develop changes into your branch
git merge develop
\

If there are merge conflicts, resolve them before continuing.

## 2. Commit and Push Your Changes

After updating your code:

```bash
# Check your current branch
git branch

# Check modifications
git status

# Stage changes
git add .

# Commit changes
git commit -m "feat: update login module"

# Push to GitHub
git push origin feature/login
```

After pushing, create a **Pull Request** on GitHub:

- Base: `develop`
- Compare: `feature/login`

Wait for review and approval before merging.

## 3. Pull and Test Before Merging to Main

The Project Leader or Tester should pull the latest `develop` branch to verify all changes.

```bash
# Switch to develop
git switch develop

# Pull latest approved changes
git pull origin develop

# Check status
git status

# View recent commits
git log --oneline -5
```

Test the updated system locally.

If everything works correctly, create a Pull Request:

- Base: `main`
- Compare: `develop`

Only merge after testing and approval.

## 4. Update Your Local Main After Approval

Once the Pull Request has been merged into `main` on GitHub:

```bash
# Switch to main
git switch main

# Download the latest approved version
git pull origin main

# Verify repository status
git status
```
=======
# carlos-paradise-rbms


CARLOS PARADISE RBMS — FIRST-TIME SETUP

The project scaffold is ready. We will use the DEVELOP branch.

IMPORTANT:
Make sure Git, PHP, Composer, Node.js, and npm are already installed on your PC.

========================================
1. CLONE THE PROJECT
========================================

If you DON'T have the project yet, open PowerShell/Terminal and run:

git clone https://github.com/vincepadilla/carlos-paradise-rbms.git
cd carlos-paradise-rbms
git switch develop
git pull origin develop

If you ALREADY cloned the project before, open the project folder and run:

git switch develop
git pull origin develop


========================================
2. SET UP THE LARAVEL BACKEND
========================================

Run:

cd apps/api
composer install
Copy-Item .env.example .env
php artisan key:generate
php artisan migrate

If Laravel asks if you want to create the SQLite database, type:

yes


========================================
3. START THE LARAVEL BACKEND
========================================

Run:

php artisan serve

DO NOT close this terminal.

Laravel should run at:

http://127.0.0.1:8000

Test the API by opening:

http://127.0.0.1:8000/api/health

You should see something like:

{"status":"ok","message":"Carlos Paradise RBMS API is running"}


========================================
4. SET UP AND START THE REACT FRONTEND
========================================

Open a SECOND PowerShell/Terminal.

Go to the Carlos Paradise project root folder first.

Then run:

cd apps/web
npm install
npm run dev

DO NOT close this terminal.

React should run at:

http://localhost:5173


========================================
5. FINAL CHECK
========================================

You should now have TWO terminals running:

TERMINAL 1:
Laravel Backend
http://127.0.0.1:8000

TERMINAL 2:
React Frontend
http://localhost:5173

API Health Check:
http://127.0.0.1:8000/api/health


========================================
IMPORTANT GIT RULE
========================================

DO NOT start coding directly on:

main
develop

For now, just make sure the project runs correctly.

We will create separate feature branches for each assigned module later.

Example:

feature/authentication
feature/room-management
feature/reservations

main = stable version
develop = combined development version
feature/... = where we individually code

If you encounter an error during setup, DO NOT randomly delete or modify project files. Send a screenshot/error first.

## Get the Landing Page Updates

Run these commands from the project’s root folder.

### 1. Check for unfinished changes

```
git status
```

Commit your unfinished work before switching branches.

### 2. Download the latest branch information

```
git fetch origin
```

### 3. Switch to the landing-page branch

**First time using this branch on your device:**

```
git switch --track origin/feature/landing-page
```

**If the branch already exists on your device:**

```
git switch feature/landing-page
```

Choose only one of the commands above.

### 4. Pull the latest code

```
git pull --ff-only
```

If this fails, share the error with the team before continuing.

### 5. Install dependencies

```
cd apps/web
npm ci
npm install react-router@7
```

This automatically installs Tailwind and the other required packages.

### 6. Start the frontend

```
npm run dev
```

Open the local URL displayed in the terminal.
>>>>>>> feature/landing-page
