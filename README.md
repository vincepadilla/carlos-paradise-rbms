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
```

This automatically installs Tailwind and the other required packages.

### 6. Start the frontend

```
npm run dev
```

Open the local URL displayed in the terminal.
