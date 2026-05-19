FROM node:20

WORKDIR /app

COPY package.json ./

RUN npm install && npm install vite

COPY . .

EXPOSE 5173

CMD ["npx", "vite", "--host", "0.0.0.0"]