const Queue = require('bull');

const pdfQueue = new Queue('pdf-processing', {
  redis: process.env.REDIS_URL || 'redis://localhost:6379'
});

class QueueService {

  async addJob(jobType, data) {
    const job = await pdfQueue.add(jobType, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false
    });

    return {
      jobId: job.id,
      status: 'queued'
    };
  }

  async getJobStatus(jobId) {
    const job = await pdfQueue.getJob(jobId);

    if (!job) {
      return { error: 'Job not found' };
    }

    const state = await job.getState();

    return {
      jobId: job.id,
      status: state,
      progress: job.progress(),
      data: state === 'completed' ? job.returnvalue : null
    };
  }
}

module.exports = new QueueService();
module.exports.pdfQueue = pdfQueue;
