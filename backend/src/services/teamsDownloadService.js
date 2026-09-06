const jwt = require('jsonwebtoken');

// Öffentliche, kurzlebige Download-Tokens speziell für den Teams-Bot: Teams-Nutzer
// haben kein Portal-Login (JWT), deshalb signieren wir einen dateispezifischen
// Token, statt den normalen, Login-geschützten Download-Endpunkt zu verwenden.
function createDownloadToken(filePath) {
  return jwt.sign({ filePath }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

function verifyDownloadToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded.filePath;
}

module.exports = { createDownloadToken, verifyDownloadToken };
