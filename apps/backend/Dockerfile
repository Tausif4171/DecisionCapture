FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/backend ./apps/backend

RUN npm install
RUN npm run build -w @decisioncapture/shared
RUN npm run db:generate -w @decisioncapture/backend
RUN npm run build -w @decisioncapture/backend

EXPOSE 4000

CMD ["sh", "-c", "npm run db:push -w @decisioncapture/backend && npm run start -w @decisioncapture/backend"]
