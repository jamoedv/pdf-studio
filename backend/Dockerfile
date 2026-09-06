FROM node:20-slim
RUN apt-get update && apt-get install -y \
    poppler-utils \
    qpdf \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    ocrmypdf \
    && rm -rf /var/lib/apt/lists/*
# Systembibliotheken, die Puppeteers gebuendeltes Chromium zum Starten braucht
# (fuer generate_pdf/fill_template/PDF-Vorlagen-Rendering). Debian Bookworm
# (Basis von node:20-slim) hat noch die "klassischen" Paketnamen ohne
# "t64"-Suffix (das betrifft erst neuere Debian/Ubuntu-Versionen).
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:all"]
