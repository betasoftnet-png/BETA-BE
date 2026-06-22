import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { getDb } from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://beta-softnet.com',
  'https://beta-softnet.com',
  'https://www.beta-softnet.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5004'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Setup uploads folder
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve uploads folder statically
app.use('/uploads', express.static(uploadDir, {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.pdf')) {
      res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(filepath) + '"');
    }
  }
}));

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
    
    // Parse responsibilities, requirements, and skills back into arrays
    const jobs = result.rows.map(row => ({
      ...row,
      responsibilities: JSON.parse(row.responsibilities || '[]'),
      requirements: JSON.parse(row.requirements || '[]'),
      skills: JSON.parse(row.skills || '[]')
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
    const { title, department, location, type, salary, description, responsibilities, requirements, skills } = req.body;
    
    // if (!title || !department || !location || !type || !salary || !description) {
    //   return res.status(400).json({ success: false, message: 'Missing required job posting parameters.' });
    // }

    const pool = await getDb();
    const id = `job-${crypto.randomUUID().slice(0, 8)}`;
    
    // Stringify arrays for storage
    const respStr = JSON.stringify(Array.isArray(responsibilities) ? responsibilities : []);
    const reqsStr = JSON.stringify(Array.isArray(requirements) ? requirements : []);
    const skillsStr = JSON.stringify(Array.isArray(skills) ? skills : []);

    await pool.query(
      `INSERT INTO jobs (id, title, department, location, type, salary, description, responsibilities, requirements, skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, title, department, location, type, salary, description, respStr, reqsStr, skillsStr]
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
        requirements: Array.isArray(requirements) ? requirements : [],
        skills: Array.isArray(skills) ? skills : []
      }
    });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ success: false, message: 'Failed to create job posting.' });
  }
});

// POST /api/jobs/apply - Submit an application with file upload and send email via Resend
app.post('/api/jobs/apply', upload.single('resume'), async (req, res) => {
  try {
    const { jobId, fullName, email, phone, coverLetter } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Missing required resume file.' });
    }

    if (!jobId || !fullName || !email || !phone) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Missing required application parameters.' });
    }

    const pool = await getDb();
    
    // Check if the job exists
    const jobCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobCheck.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Target job opening not found.' });
    }
    const job = jobCheck.rows[0];

    // Check for duplicate application (One candidate can apply for one job only one time)
    const dupCheck = await pool.query('SELECT * FROM applications WHERE jobId = $1 AND email = $2', [jobId, email]);
    if (dupCheck.rows.length > 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'You have already applied for this job.' });
    }

    const id = `app-${crypto.randomUUID().slice(0, 8)}`;
    const resumeUrl = `/uploads/${req.file.filename}`;
    const absoluteResumeUrl = `${req.protocol}://${req.get('host')}${resumeUrl}`;
    
    // Insert into database
    await pool.query(
      `INSERT INTO applications (id, jobId, fullName, email, phone, resumeUrl, coverLetter, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, jobId, fullName, email, phone, resumeUrl, coverLetter || '', 'pending']
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
              <td style="padding: 4px 0; font-weight: bold;">Phone Number:</td>
              <td style="padding: 4px 0;">${phone}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Resume Link:</td>
              <td style="padding: 4px 0;"><a href="${absoluteResumeUrl}" target="_blank" style="color: #4f46e5; text-decoration: none;">View Resume</a></td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; line-height: 1.6; color: #64748b;">
          Next steps: Our engineering directors review candidate portfolios weekly. If your skills align with our current objectives, we will reach out via email to schedule a technical session.
        </p>
        
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center;">
          © 2026 Beta Softnet Pvt Ltd. PH Road Manavalanagar, Thiruvallur.
        </div>
      </div>
    `;

    // Attempt to send email via BNX Mail public endpoint
    let emailSent = false;
    let emailError = null;

    try {
      const mailApiUrl = process.env.MAIL_API_URL || 'https://api.bnxmail.com';
      const response = await fetch(`${mailApiUrl}/api/mail/public/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Public-Mail-Token': process.env.PUBLIC_MAIL_TOKEN || 'secure-beta-to-bnx-secret-2026'
        },
        body: JSON.stringify({
          to: email,
          subject: emailSubject,
          body: emailHtml,
          isHtml: true,
          html: true,
          fromName: 'Beta Softnet Careers'
        })
      });
      
      const resData = await response.json();
      if (response.ok && resData.success) {
        emailSent = true;
        console.log(`Confirmation email sent successfully via BNX Mail API to ${email}`);
      } else {
        throw new Error(resData.message || 'API error response');
      }
    } catch (err) {
      console.error('Failed to send confirmation email via BNX Mail API:', err);
      emailError = err.message || err;
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully.',
      data: { id, jobId, fullName, email, phone, resumeUrl, coverLetter },
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
        a.phone,
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

// PUT /api/jobs/:id - Edit an existing job posting
app.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, department, location, type, salary, description, responsibilities, requirements, skills } = req.body;

    if (!title || !department || !location || !type || !salary || !description) {
      return res.status(400).json({ success: false, message: 'Missing required job posting parameters.' });
    }

    const pool = await getDb();
    
    // Stringify arrays for storage
    const respStr = JSON.stringify(Array.isArray(responsibilities) ? responsibilities : []);
    const reqsStr = JSON.stringify(Array.isArray(requirements) ? requirements : []);
    const skillsStr = JSON.stringify(Array.isArray(skills) ? skills : []);

    const result = await pool.query(
      `UPDATE jobs 
       SET title = $1, department = $2, location = $3, type = $4, salary = $5, description = $6, responsibilities = $7, requirements = $8, skills = $9
       WHERE id = $10`,
      [title, department, location, type, salary, description, respStr, reqsStr, skillsStr, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Job posting not found.' });
    }

    res.json({
      success: true,
      message: 'Job posting updated successfully.',
      data: {
        id,
        title,
        department,
        location,
        type,
        salary,
        description,
        responsibilities: Array.isArray(responsibilities) ? responsibilities : [],
        requirements: Array.isArray(requirements) ? requirements : [],
        skills: Array.isArray(skills) ? skills : []
      }
    });
  } catch (error) {
    console.error('Error updating job:', error);
    res.status(500).json({ success: false, message: 'Failed to update job posting.' });
  }
});

// DELETE /api/jobs/:id - Delete a job posting (cascades to applications)
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getDb();
    
    const result = await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Job posting not found.' });
    }
    
    res.json({ success: true, message: 'Job posting and associated applications deleted successfully.' });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ success: false, message: 'Failed to delete job posting.' });
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
