FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache bash

COPY package.json ./

RUN npm install --production

COPY . .

RUN mkdir -p ./uploads ./previews ./desensitized

EXPOSE 3000

CMD ["node", "src/app.js"]
