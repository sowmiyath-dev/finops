#!/bin/bash
set -e

echo "=== FinOps CUR Portal — EC2 Deploy ==="

# 1. Install Docker if missing
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Log out and back in, then re-run this script."
  exit 0
fi

# 2. Install Docker Compose if missing
if ! command -v docker-compose &>/dev/null; then
  echo "Installing Docker Compose..."
  sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

# 3. Create backend .env if missing
if [ ! -f backend/.env ]; then
  echo "Creating backend/.env from example..."
  cp backend/.env.example backend/.env
  # Generate keys
  SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  FERNET=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "REPLACE_WITH_FERNET_KEY")
  sed -i "s/change-me-to-a-long-random-string/$SECRET/" backend/.env
  sed -i "s/change-me-run-python-cryptography-fernet-generate-key/$FERNET/" backend/.env
  echo ""
  echo ">>> Edit backend/.env and set ADMIN_EMAIL, PORTAL_ACCOUNT_ID, then re-run."
  exit 0
fi

# 4. Build and start
echo "Building and starting containers..."
docker-compose up -d --build

echo ""
echo "=== Deployment complete ==="
echo "Frontend : http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_EC2_IP'):3000"
echo "Backend  : http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_EC2_IP'):8000/docs"
echo ""
echo "Logs: docker-compose logs -f"
