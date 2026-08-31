FROM node:20-slim

RUN apt-get update && apt-get install -y \
    poppler-utils \
    qpdf \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    ocrmypdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:all"]
