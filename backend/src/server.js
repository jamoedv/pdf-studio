const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');
dotenv.config();
const fsSync = require('fs');
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const processedDir = process.env.PROCESSED_DIR || 'processed';
if (!fsSync.existsSync(uploadDir)) fsSync.mkdirSync(uploadDir, { recursive: true });
if (!fsSync.existsSync(processedDir)) fsSync.mkdirSync(processedDir, { recursive: true });
const path = require('path');
const apiRoutes = require('./routes/api');
const chatRoutes = require('./routes/chat');
const templatesRoutes = require('./routes/templates');
const historyRoutes = require('./routes/history');
const extractRoutes = require('./routes/extract');
const intelligenceRoutes = require('./routes/intelligence');
const toolsRoutes = require('./routes/tools');
const authRoutes = require('./routes/auth');
const onedriveCallbackRoutes = require('./routes/onedrive-callback');
const teamsBotRoutes = require('./routes/teams-bot');
const statsRoutes = require('./routes/stats');
const complianceRoutes = require('./routes/compliance');
const templatesFillRoutes = require('./routes/templates-fill');
const templatesManageRoutes = require('./routes/templates-manage');
const examGradingRoutes = require('./routes/exam-grading');
const assistantRoutes = require('./routes/assistant');
const workflowsRoutes = require('./routes/workflows');
const usageRoutes = require('./routes/usage');
const onedriveRoutes = require('./routes/onedrive');
const errorHandler = require('./middleware/errorHandler');
const app = express();
const PORT = process.env.PORT || 3000;
app.use((req, res, next) => {
  if (req.path.startsWith('/outlook')) {
    helmet({
 frameguard: false,
 crossOriginResourcePolicy: { policy: 'cross-origin' },
 contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: [
            "'self'",
            "https://outlook.office.com",
            "https://outlook.office365.com",
            "https://outlook.live.com",
            "https://*.outlook.com"
          ],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://appsforoffice.microsoft.com"],
          styleSrc: ["'self'", "'unsafe-inline'"]
        }
      }
    })(req, res, next);
  } else {
    helmet()(req, res, next);
  }
});
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/outlook', express.static(path.join(__dirname, '..', 'public', 'outlook')));
app.use('/api/v1/openapi', express.static(path.join(__dirname, '..', 'public', 'openapi')));
// Health-Check MUSS ganz vorne stehen, bevor irgendein Router mit pauschalem
// requireAuth registriert wird - sonst fängt der erstbeste geschützte Router
// die Anfrage ab (kein passender Pfad dort, aber requireAuth prüft trotzdem
// jede Anfrage, die ihn erreicht), noch bevor sie hier ankommt.
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
app.use('/api/v1', onedriveCallbackRoutes);
app.use('/api', teamsBotRoutes);
app.use('/api/v1', authRoutes);
app.use('/api/v1', statsRoutes);
app.use('/api/v1', complianceRoutes);
app.use('/api/v1', templatesFillRoutes);
app.use('/api/v1', templatesManageRoutes);
app.use('/api/v1', examGradingRoutes);
app.use('/api/v1', assistantRoutes);
app.use('/api/v1', workflowsRoutes);
app.use('/api/v1', usageRoutes);
app.use('/api/v1', onedriveRoutes);
app.use('/api/v1', apiRoutes);
app.use('/api/v1', chatRoutes);
app.use('/api/v1', templatesRoutes);
app.use('/api/v1', historyRoutes);
app.use('/api/v1', extractRoutes);
app.use('/api/v1', intelligenceRoutes);
app.use('/api/v1/tools', toolsRoutes);
app.use(errorHandler);
app.listen(PORT, () => {
  console.log(`🚀 PDF Processing API running on port ${PORT}`);
});
module.exports = app;
