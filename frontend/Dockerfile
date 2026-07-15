# Frontend: Next.js 16 dev server. Source is bind-mounted in compose for hot reload,
# so this image only needs the installed node_modules.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
