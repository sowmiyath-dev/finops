# FinOps CUR Portal — Work Log & Command Reference

---

## 1. Git Commands (Local Machine — D:\finops-cur-dashboard)

| Command | Explanation |
|---------|-------------|
| `git init` | Initialize a new Git repository in the project folder |
| `git add .` | Stage all changed files for commit |
| `git add backend/` | Stage only backend folder changes |
| `git add frontend/` | Stage only frontend folder changes |
| `git add backend/app/services/cost_service.py` | Stage a specific single file |
| `git commit -m "your message"` | Save staged changes with a description |
| `git branch -M main` | Rename current branch to main |
| `git remote add origin https://github.com/sowmiyath-dev/finops.git` | Link local repo to GitHub |
| `git push -u origin main` | Push code to GitHub for the first time |
| `git push` | Push latest commits to GitHub after first push |
| `git status` | Show which files have been changed or staged |
| `git diff backend/` | Show exact line-by-line changes in backend folder |
| `git log --oneline` | Show commit history in compact one-line format |

---

## 2. EC2 — Server Setup Commands

| Command | Explanation |
|---------|-------------|
| `ssh -i your-key.pem ec2-user@YOUR_EC2_IP` | Connect to EC2 instance via SSH |
| `sudo yum install -y git` | Install Git on Amazon Linux EC2 |
| `sudo apt install -y git` | Install Git on Ubuntu EC2 |
| `git clone https://github.com/sowmiyath-dev/finops.git` | Download project code from GitHub to EC2 |
| `cd ~/finops` | Navigate into the cloned project folder |

---

## 3. EC2 — Docker Setup Commands

| Command | Explanation |
|---------|-------------|
| `curl -fsSL https://get.docker.com \| sh` | Install Docker on EC2 |
| `sudo usermod -aG docker $USER` | Add current user to Docker group so no sudo needed |
| `sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose` | Install Docker Compose |
| `sudo chmod +x /usr/local/bin/docker-compose` | Make Docker Compose executable |
| `docker --version` | Verify Docker is installed |
| `docker-compose --version` | Verify Docker Compose is installed |

---

## 4. EC2 — Environment Setup Commands

| Command | Explanation |
|---------|-------------|
| `cp backend/.env.example backend/.env` | Create .env file from the example template |
| `nano backend/.env` | Open and edit the .env configuration file |
| `python3 -c "import secrets; print(secrets.token_hex(32))"` | Generate a secure SECRET_KEY value |
| `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | Generate FERNET_KEY for encrypting AWS credentials |

---

## 5. EC2 — Docker Compose Commands

| Command | Explanation |
|---------|-------------|
| `docker-compose up -d --build` | Build images and start all 3 containers in background |
| `docker-compose up -d` | Start all containers without rebuilding |
| `docker-compose down` | Stop and remove all running containers |
| `docker-compose restart` | Restart all containers |
| `docker-compose restart backend` | Restart only the backend container |
| `docker-compose logs -f` | Stream live logs from all containers |
| `docker-compose logs -f backend` | Stream live logs from backend only |
| `docker-compose logs -f frontend` | Stream live logs from frontend only |
| `docker-compose logs -f db` | Stream live logs from database only |
| `docker-compose ps` | Show status of all containers in the project |
| `docker ps` | Show all currently running Docker containers |
| `docker ps -a` | Show all containers including stopped ones |

---

## 6. EC2 — Update Code from GitHub

| Command | Explanation |
|---------|-------------|
| `cd ~/finops` | Navigate to the project folder on EC2 |
| `git pull` | Pull latest code changes from GitHub |
| `docker-compose up -d --build` | Rebuild and restart containers with new code |

---

## 7. EC2 — Maintenance Commands

| Command | Explanation |
|---------|-------------|
| `docker stats` | Show live CPU and memory usage of all containers |
| `docker system prune -f` | Remove unused images and containers to free disk space |
| `docker-compose exec db psql -U finops -d finops_db` | Open PostgreSQL shell inside the database container |
| `chmod +x deploy.sh` | Make the deploy script executable |
| `./deploy.sh` | Run the automated deployment script |

---

## 8. Access URLs After Deployment

| URL | Service |
|-----|---------|
| `http://YOUR_EC2_IP:3000` | Frontend — Next.js web application |
| `http://YOUR_EC2_IP:8000/docs` | Backend API documentation — Swagger UI |
| `http://YOUR_EC2_IP:8000/health` | Backend health check endpoint |

---

## Quick Reference — Common Flows

### First Time Deploy on EC2
```bash
ssh -i your-key.pem ec2-user@YOUR_EC2_IP
git clone https://github.com/sowmiyath-dev/finops.git
cd finops
cp backend/.env.example backend/.env
nano backend/.env
docker-compose up -d --build
docker ps
```

### Push All Changes from Local Machine
```bash
git add .
git commit -m "your message"
git push
```

### Push Only Backend Changes
```bash
git add backend/
git commit -m "fix: updated backend logic"
git push
```

### Push Only Frontend Changes
```bash
git add frontend/
git commit -m "feat: updated UI"
git push
```

### Pull Latest Code and Redeploy on EC2
```bash
cd ~/finops
git pull
docker-compose up -d --build
```

---

## Project Structure

```
finops-cur-dashboard/
├── backend/                        # FastAPI Python backend
│   ├── app/
│   │   ├── models/                 # Database models and schemas
│   │   ├── routers/                # API route handlers
│   │   ├── services/               # AWS and business logic
│   │   ├── config.py               # App configuration
│   │   └── main.py                 # App entry point + daily scheduler
│   ├── .env                        # Environment variables (not in git)
│   ├── .env.example                # Environment variable template
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                       # Next.js 14 frontend
│   └── src/app/
│       ├── auth/                   # Login and MFA pages
│       ├── dashboard/              # Control Tower and account pages
│       ├── reports/                # Cost reports with filters and CSV export
│       ├── sync-logs/              # Sync history page
│       ├── admin/                  # User management page
│       └── onboard/                # Add Control Tower page
├── docker-compose.yml              # Runs db + backend + frontend together
├── nginx.conf                      # Reverse proxy config for port 80
├── deploy.sh                       # One-command deployment script
└── README.md                       # Full setup documentation
```

---

## .env File Reference (backend/.env)

```env
DATABASE_URL=postgresql+asyncpg://finops:finops_secure_pass@db:5432/finops_db
SECRET_KEY=<generate using python3 secrets command above>
FERNET_KEY=<generate using python3 cryptography command above>
ADMIN_EMAIL=admin@yourcompany.com
PORTAL_ACCOUNT_ID=123456789012
```

---

## GitHub Repository

- URL: https://github.com/sowmiyath-dev/finops
- Branch: main
