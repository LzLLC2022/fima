# 개발서버 (Development Server) Definition

## Terminology
When the user mentions "개발서버" (dev server, development server):
- **DO NOT** confuse it with the local Windows PC (the current workspace environment).
- **IT REFERS TO** an external Ubuntu server.

## Context & Environment
- The local environment is a Windows PC.
- The external "개발서버" (Ubuntu server) is used for running cron jobs, background tasks, or specific Linux-based automation (e.g., the cron job running `scratch/run_fima_scraper.sh`).
- Since you (the agent) are running on the local Windows PC, you do not have direct access to the Ubuntu server's terminal or filesystem unless the user provides specific connection instructions.

## Actions
- If the user asks to check something on the "개발서버", always remember it is an Ubuntu server, not the local Windows machine. 
- You can analyze the expected behavior of the scripts running on that Ubuntu server by reading the source code available in the local repository.
- Do not attempt to use Windows-specific tools (like Task Scheduler) when diagnosing issues related to the "개발서버".
