const path = require('path');
const { v4: uuidv4 } = require('uuid');
const watchedFolderService = require('./watchedFolderService');
const graphService = require('./graphService');
const agentEngine = require('./agentEngine');
const { runWithUser } = require('./anthropicClient');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

async function listFolderItems(watch) {
  if (watch.source === 'sharepoint') {
    return graphService.listSharePointFolder(watch.username, watch.siteId, watch.folderId, watch.driveId);
  }
  return graphService.listOneDrive(watch.username, watch.folderId);
}

async function downloadItem(watch, item) {
  const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = path.join(UPLOAD_DIR, `${uuidv4()}_${safeName}`);
  if (watch.source === 'sharepoint') {
    await graphService.downloadItem(watch.username, { driveId: watch.driveId, itemId: item.id }, destPath);
  } else {
    await graphService.downloadItem(watch.username, { itemId: item.id }, destPath);
  }
  return destPath;
}

async function uploadToDestination(watch, filePath, filename) {
  const dest = watch.destination;
  if (!dest) return null;
  if (dest.source === 'sharepoint') {
    return graphService.uploadItem(watch.username, { driveId: dest.driveId, folderId: dest.folderId, filename }, filePath);
  }
  return graphService.uploadItem(watch.username, { folderId: dest.folderId, filename }, filePath);
}

async function notify(watch, message) {
  if (watch.notifyEmail) {
    try {
      await graphService.sendMail(watch.username, {
        to: watch.notifyEmail,
        subject: `PDF Studio - Ordner "${watch.folderLabel}" verarbeitet`,
        body: message,
      });
    } catch (err) {
      console.error(`Watch ${watch.id}: E-Mail-Benachrichtigung fehlgeschlagen:`, err.message);
    }
  }
  if (watch.notifyTeamsUserId) {
    try {
      // Lazy require, um einen Zirkelbezug beim Laden der Module zu vermeiden.
      const { sendProactiveMessage } = require('./teamsBotService');
      await sendProactiveMessage(watch.notifyTeamsUserId, message);
    } catch (err) {
      console.error(`Watch ${watch.id}: Teams-Benachrichtigung fehlgeschlagen:`, err.message);
    }
  }
}

// Verarbeitet EINEN überwachten Ordner: neue Dateien seit dem letzten Durchlauf
// finden, durch die Agenten-Logik mit der konfigurierten Anweisung schicken,
// Ergebnis optional zurückschreiben, Benachrichtigung verschicken.
async function processWatch(watch) {
  let items;
  try {
    items = await listFolderItems(watch);
  } catch (err) {
    console.error(`Watch ${watch.id}: Ordner konnte nicht gelesen werden:`, err.message);
    return;
  }

  const newItems = items.filter((it) => !it.isFolder && !watch.seenItemIds.includes(it.id));
  if (newItems.length === 0) {
    watchedFolderService.updateWatch(watch.id, { lastChecked: new Date().toISOString() });
    return;
  }

  console.log(`Watch ${watch.id} (${watch.folderLabel}): ${newItems.length} neue Datei(en) gefunden.`);
  const processedNames = [];

  for (const item of newItems) {
    try {
      const localPath = await downloadItem(watch, item);
      const result = await runWithUser(watch.username, () =>
        agentEngine.runAgentLoop({
          history: [],
          message: watch.instruction,
          fileIds: [{ fileId: localPath, filename: item.name }],
        })
      );

      for (const outputPath of result.outputFiles || []) {
        const outName = outputPath.split(/[/\\]/).pop();
        await uploadToDestination(watch, outputPath, outName);
      }

      processedNames.push(item.name);
    } catch (err) {
      console.error(`Watch ${watch.id}: Fehler bei Datei "${item.name}":`, err.message);
    }
  }

  watchedFolderService.markItemsSeen(watch.id, newItems.map((it) => it.id));

  if (processedNames.length > 0) {
    await notify(watch, `${processedNames.length} neue Datei(en) aus "${watch.folderLabel}" wurden automatisch verarbeitet:\n${processedNames.map((n) => `- ${n}`).join('\n')}`);
  }
}

async function pollAllWatches() {
  const watches = watchedFolderService.listAllActiveWatches();
  for (const watch of watches) {
    await processWatch(watch);
  }
}

let started = false;
function startPolling(intervalMinutes = 5) {
  if (started) return;
  started = true;
  const cron = require('node-cron');
  // Feste, einfache Voreinstellung statt pro Ordner konfigurierbarem Intervall -
  // hält die Portal-Oberfläche simpel.
  cron.schedule(`*/${intervalMinutes} * * * *`, () => {
    pollAllWatches().catch((err) => console.error('Ordner-Überwachung Fehler:', err.message));
  });
  console.log(`📁 Ordner-Überwachung gestartet (alle ${intervalMinutes} Minuten).`);
}

module.exports = { startPolling, pollAllWatches, processWatch };
