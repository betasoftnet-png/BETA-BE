import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Resend } from 'resend';
import { getDb } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize Resend
const resendApiKey = process.env.RESEND_API_KEY;
let resend = null;
if (resendApiKey && !resendApiKey.startsWith('re_your_api_key')) {
  resend = new Resend(resendApiKey);
  console.log('Resend client initialized successfully.');
} else {
  console.warn('Resend API key is missing or is using placeholder. Email delivery will run in SIMULATED mode logging output to terminal.');
}

// GET /api/jobs - List all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const pool = await getDb();
    const result = await pool.query('SELECT * FROM jobs ORDER BY createdAt DESC');
    
    // Parse responsibilities and requirements back into arrays
    const jobs = result.rows.map(row => ({
      ...row,
      responsibilities: JSON.parse(row.responsibilities || '[]'),
      requirements: JSON.parse(row.requirements || '[]')
    }));
    
    res.json({ success: true, data: jobs });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve jobs.' });
  }
});

// POST /api/jobs - Create a new job listing
app.post('/api/jobs', async (req, res) => {
  try {
    const { title, department, location, type, salary, description, responsibilities, requirements } = req.body;
    
    if (!title || !department || !location || !type || !salary || !description) {
      return res.status(400).json({ success: false, message: 'Missing required job posting parameters.' });
    }

    const pool = await getDb();
    const id = `job-${crypto.randomUUID().slice(0, 8)}`;
    
    // Stringify arrays for storage
    const respStr = JSON.stringify(Array.isArray(responsibilities) ? responsibilities : []);
    const reqsStr = JSON.stringify(Array.isArray(requirements) ? requirements : []);

    await pool.query(
      `INSERT INTO jobs (id, title, department, location, type, salary, description, responsibilities, requirements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, title, department, location, type, salary, description, respStr, reqsStr]
    );

    res.status(201).json({
      success: true,
      message: 'Job posting created successfully.',
      data: {
        id,
        title,
        department,
        location,
        type,
        salary,
        description,
        responsibilities: Array.isArray(responsibilities) ? responsibilities : [],
        requirements: Array.isArray(requirements) ? requirements : []
      }
    });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ success: false, message: 'Failed to create job posting.' });
  }
});

// POST /api/jobs/apply - Submit an application and send email via Resend
app.post('/api/jobs/apply', async (req, res) => {
  try {
    const { jobId, fullName, email, resumeUrl, coverLetter } = req.body;

    if (!jobId || !fullName || !email || !resumeUrl) {
      return res.status(400).json({ success: false, message: 'Missing required application parameters.' });
    }

    const pool = await getDb();
    
    // Check if the job exists
    const jobCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Target job opening not found.' });
    }
    const job = jobCheck.rows[0];

    const id = `app-${crypto.randomUUID().slice(0, 8)}`;
    
    // Insert into database
    await pool.query(
      `INSERT INTO applications (id, jobId, fullName, email, resumeUrl, coverLetter, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, jobId, fullName, email, resumeUrl, coverLetter || '', 'pending']
    );

    // Email content
    const emailSubject = `Application Received: ${job.title} at Beta Softnet`;
    const emailHtml = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 15px; margin-bottom: 20px;">
          <h2 style="color: #4f46e5; margin: 0; font-size: 24px; letter-spacing: -0.5px;">Beta Softnet</h2>
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; font-weight: bold;">Careers & Talent</span>
        </div>
        
        <p style="font-size: 16px; line-height: 1.6; color: #334155; margin-bottom: 15px;">Hi <strong>${fullName}</strong>,</p>
        
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
          Thank you for applying for the <strong>${job.title}</strong> role at Beta Softnet! We have received your submission details and our talent acquisition panel has been notified.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
          <h4 style="margin-top: 0; color: #1e293b; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px;">Submitted Details</h4>
          <table style="width: 100%; font-size: 13px; color: #475569;">
            <tr>
              <td style="padding: 4px 0; font-weight: bold; width: 120px;">Position:</td>
              <td style="padding: 4px 0;">${job.title}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Department:</td>
              <td style="padding: 4px 0;">${job.department}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Location:</td>
              <td style="padding: 4px 0;">${job.location} (${job.type})</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Resume Link:</td>
              <td style="padding: 4px 0;"><a href="${resumeUrl}" target="_blank" style="color: #4f46e5; text-decoration: none;">View Resume</a></td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; line-height: 1.6; color: #64748b;">
          Next steps: Our engineering directors review candidate portfolios weekly. If your skills align with our current objectives, we will reach out via email to schedule a technical session.
        </p>
        
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center;">
          © 2026 Beta Softnet Corporation. 100 Federated Plaza, San Francisco, CA.
        </div>
      </div>
    `;

    // Attempt to send email via Resend
    let emailSent = false;
    let emailError = null;

    if (resend) {
      try {
        const { data, error } = await resend.emails.send({
          from: 'Beta Softnet Careers <onboarding@resend.dev>',
          to: [email],
          subject: emailSubject,
          html: emailHtml
        });
        
        if (error) {
          throw new Error(error.message || JSON.stringify(error));
        }
        
        console.log(`Email successfully dispatched via Resend. Email ID: ${data?.id}`);
        emailSent = true;
      } catch (err) {
        console.error('Failed to send email via Resend:', err);
        emailError = err.message || err;
      }
    } else {
      console.log('--- SIMULATED EMAIL DELIVERED ---');
      console.log(`To: ${email}`);
      console.log(`Subject: ${emailSubject}`);
      console.log(`HTML Payload:\n${emailHtml}`);
      console.log('---------------------------------');
      emailSent = true;
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully.',
      data: { id, jobId, fullName, email, resumeUrl, coverLetter },
      emailStatus: emailSent ? 'sent' : 'failed',
      emailError: emailError
    });

  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({ success: false, message: 'Failed to submit job application.' });
  }
});

// GET /api/applications - Get all job applications with job details (Admin route)
app.get('/api/applications', async (req, res) => {
  try {
    const pool = await getDb();
    const query = `
      SELECT 
        a.id, 
        a.fullName, 
        a.email, 
        a.resumeUrl, 
        a.coverLetter, 
        a.status, 
        a.createdAt,
        j.title as "jobTitle",
        j.department as "jobDepartment",
        j.location as "jobLocation"
      FROM applications a
      JOIN jobs j ON a.jobId = j.id
      ORDER BY a.createdAt DESC
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve applications.' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Beta backend server running on http://localhost:${PORT}`);
});
