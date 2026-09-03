---
description: Git Commit & Push Guidelines for Vercel Deployment
---

# Git Commit and Push Guidelines

When making commits and pushing to the Fima Github repository, you MUST ensure that the Git user email is set to `company@lim.kr`.

This is a strict requirement because **Vercel** only recognizes pushes and triggers deployments when the commit is authored by this specific email address.

## How to verify
Before pushing, ensure the local git config is correct:
```bash
git config user.email
```
If it is not `company@lim.kr`, set it using:
```bash
git config user.email "company@lim.kr"
```

## Rule: Push upon completion
Always execute a `git commit` and `git push` automatically after all code modifications for a task are completed and verified. Do not wait for the user to explicitly ask you to push.
