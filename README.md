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