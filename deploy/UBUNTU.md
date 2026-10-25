# Colocar o Seu Mundo Novo no ar (Ubuntu)

Tudo no mesmo servidor: o **nginx** entrega o site (pasta `dist`) e repassa `/api` para o **Node** (porta 8787, fechada para fora). O **Postgres** fica na mesma máquina. Site e API no mesmo domínio: o login por cookie funciona sem ajuste.

Requisitos: Ubuntu 22.04 ou 24.04, 2 GB de RAM (1 GB funciona com swap), um domínio apontando para o IP do servidor (registro **A** no seu DNS).

## 1. Subir o código para o GitHub (no seu PC)
1. Em github.com repositório: https://github.com/mourinha112/virarua (deixe **privado**).
2. Na pasta do projeto:
   ```
   git remote add origin https://github.com/mourinha112/virarua.git
   git push -u origin main
   ```
3. No dia a dia: `git add -A` → `git commit -m "o que mudou"` → `git push`.

## 2. Preparar o servidor (uma vez)
```
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx postgresql git curl ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
sudo adduser --system --group --home /srv/seumundonovo smn
```
Se o servidor tiver 1 GB de RAM, crie 2 GB de swap:
```
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Banco de dados
Troque `SENHA_FORTE` por uma senha gerada (ex.: `openssl rand -hex 24`).
```
sudo -u postgres psql -c "create user smn with password 'SENHA_FORTE';"
sudo -u postgres psql -c "create database smn owner smn;"
```
O banco nasce **zerado**: nenhuma casa. A semente só coloca os 5.570 municípios e o catálogo de avatar.

## 4. Baixar o código e configurar
Repositório privado: crie uma *deploy key* (chave só de leitura) no servidor e cadastre no GitHub em Settings → Deploy keys.
```
sudo -u smn mkdir -p /srv/seumundonovo/.ssh
sudo -u smn ssh-keygen -t ed25519 -N "" -f /srv/seumundonovo/.ssh/id_ed25519
sudo cat /srv/seumundonovo/.ssh/id_ed25519.pub     # cole no GitHub → Deploy keys
sudo -u smn git clone git@github.com:mourinha112/virarua.git /srv/seumundonovo/app
sudo cp /srv/seumundonovo/app/.env.example /srv/seumundonovo/.env
sudo chown smn:smn /srv/seumundonovo/.env && sudo chmod 600 /srv/seumundonovo/.env
sudo nano /srv/seumundonovo/.env
```
Preencha **no servidor** (nunca no git, nunca em chat):
```
SMN_AMBIENTE=producao
PORT=8787
DATABASE_URL=postgres://smn:SENHA_FORTE@127.0.0.1:5432/smn
SMN_URL_PUBLICA=https://SEU_DOMINIO
SMN_SEGREDO=           # openssl rand -hex 32
SMN_CHAVE_CRIPTO=      # openssl rand -hex 32  (guarde cópia: sem ela o token do Instagram não abre)
IG_ADAPTADOR=dev       # troque para oficial quando o app da Meta estiver aprovado
```
Linhas vazias usam o padrão do código.

## 5. Primeira instalação
```
cd /srv/seumundonovo/app
sudo -u smn bash -c 'set -a; . /srv/seumundonovo/.env; set +a; npm ci && npm run db:migrar && npm run db:semear && npm run build'
sudo cp deploy/seumundonovo.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now seumundonovo
curl http://127.0.0.1:8787/api/saude
```
Deixe o `smn` reiniciar só esse serviço sem senha (usado pelo `atualizar.sh`):
```
echo 'smn ALL=(root) NOPASSWD: /usr/bin/systemctl restart seumundonovo' | sudo tee /etc/sudoers.d/smn
```

## 6. Nginx e HTTPS
```
sudo cp deploy/nginx-seumundonovo.conf /etc/nginx/sites-available/seumundonovo
sudo sed -i 's/SEU_DOMINIO/seudominio.com.br/g' /etc/nginx/sites-available/seumundonovo
sudo ln -s /etc/nginx/sites-available/seumundonovo /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```
O HTTPS é obrigatório: a Meta só chama webhook em `https://`.

## 7. Atualizar depois
No PC: `git push`. No servidor:
```
sudo -u smn bash /srv/seumundonovo/app/deploy/atualizar.sh
```
Ele faz backup do banco antes de migrar.

## 8. Painel admin
Os papéis de admin só se dão pelo terminal do servidor (de propósito):
```
cd /srv/seumundonovo/app
sudo -u smn bash -c 'set -a; . /srv/seumundonovo/.env; set +a; npx tsx server/src/modulos/admin/cli.ts conceder <SEU_USER_ID> admin_tecnico "dono do jogo"'
```
Seu `user_id` aparece depois que você mesmo cria sua casa comentando no post e confirma o link. Daí, entre logado no jogo e abra `https://SEU_DOMINIO/admin.html`.
Papéis: `admin_tecnico`, `operador_integracao`, `moderador`, `editor_conteudo`.

## 9. Saúde e logs
```
sudo systemctl status seumundonovo
sudo journalctl -u seumundonovo -f        # log ao vivo
```
Backup diário (crontab do smn: `sudo -u smn crontab -e`):
```
0 4 * * * pg_dump -Fc postgres://smn:SENHA_FORTE@127.0.0.1:5432/smn > /srv/seumundonovo/backups/diario-$(date +\%u).dump
```

## E a Vercel?
Dá para pôr só o site na Vercel e a API no Ubuntu, mas não compensa: o front chama `/api` no mesmo domínio, então seria preciso configurar um *rewrite* na Vercel para o servidor, e o servidor continua necessário para API, worker e banco. Tudo no Ubuntu é mais simples, mais barato e tem um ponto só para cuidar.
