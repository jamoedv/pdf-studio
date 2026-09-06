const { AsyncLocalStorage } = require('async_hooks');
const Anthropic = require('@anthropic-ai/sdk');
const usageTracking = require('./usageTrackingService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const requestContext = new AsyncLocalStorage();

// Wird von der Middleware pro Request aufgerufen, damit alle darin verschachtelten
// (auch asynchronen) Funktionsaufrufe wissen, welcher Nutzer die Anfrage gestellt hat -
// ohne dass jede Service-Funktion einen zusätzlichen "username"-Parameter bräuchte.
function runWithUser(username, fn) {
  return requestContext.run({ username }, fn);
}

function getCurrentUsername() {
  return requestContext.getStore()?.username || 'unbekannt';
}

// Express-Middleware, die den Nutzer-Kontext erneut setzt - notwendig, weil
// AsyncLocalStorage den Kontext nicht zuverlässig durch Datei-Upload-Middleware
// (z.B. multer) hindurch weiterreicht. Direkt NACH dem Upload einsetzen,
// VOR dem eigentlichen Route-Handler.
function withUserContext(req, res, next) {
  runWithUser(req.user?.username, next);
}

// Ersetzt direkte anthropic.messages.create()-Aufrufe. "feature" ist ein kurzer,
// fester Bezeichner (z.B. "extract-keyvalues", "exam-grading", "assistant-chat"),
// damit die Auswertung später nach Funktion aufgeschlüsselt werden kann.
async function createMessage(params, feature) {
  const response = await anthropic.messages.create(params);
  try {
    usageTracking.logUsage({
      username: getCurrentUsername(),
      feature,
      model: params.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheCreationTokens: response.usage?.cache_creation_input_tokens,
      cacheReadTokens: response.usage?.cache_read_input_tokens,
    });
  } catch (err) {
    console.error('Usage-Tracking fehlgeschlagen (Antwort selbst ist trotzdem gültig):', err.message);
  }
  return response;
}

module.exports = { createMessage, runWithUser, getCurrentUsername, withUserContext };
