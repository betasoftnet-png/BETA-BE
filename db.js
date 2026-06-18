import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

let pool = null;

export async function getDb() {
  if (pool) return pool;

  const user = process.env.DB_USER;
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const password = process.env.DB_PASSWORD;
  const port = process.env.DB_PORT;

  if (!user || !host || !database || !password) {
    throw new Error('Database credentials/host parameters (DB_USER, DB_HOST, DB_NAME, DB_PASSWORD) are not fully defined in backend environmental configuration.');
  }

  pool = new Pool({
    user,
    host,
    database,
    password,
    port: port ? parseInt(port, 10) : 5432
  });

  // Test connection and initialize tables
  let client;
  try {
    client = await pool.connect();
    
    // Create tables using PostgreSQL syntax
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        department VARCHAR(100) NOT NULL,
        location VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        salary VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        responsibilities TEXT NOT NULL,   -- JSON string array
        requirements TEXT NOT NULL,       -- JSON string array
        skills TEXT NOT NULL DEFAULT '[]', -- JSON string array
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id VARCHAR(50) PRIMARY KEY,
        jobId VARCHAR(50) NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        fullName VARCHAR(150) NOT NULL,
        email VARCHAR(150) NOT NULL,
        resumeUrl TEXT NOT NULL,
        coverLetter TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(jobId, email)
      );
    `);

    // Ensure unique constraint exists for existing deployments
    try {
      await client.query('ALTER TABLE applications ADD CONSTRAINT unique_job_email UNIQUE (jobId, email)');
    } catch (err) {
      // Constraint might already exist
    }

    // Ensure skills column exists for existing jobs table
    try {
      await client.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills TEXT NOT NULL DEFAULT '[]'");
    } catch (err) {
      // Column might already exist
    }

    // Seed initial jobs if database is empty
    const countRes = await client.query('SELECT COUNT(*) FROM jobs');
    const count = parseInt(countRes.rows[0].count, 10);
    
    if (count === 0) {
      console.log('Seeding initial jobs to PostgreSQL database...');
      
      const initialJobs = [
        {
          id: 'job-1',
          title: 'Lead Cryptography Engineer',
          department: 'Engineering',
          location: 'Remote',
          type: 'Full-time',
          salary: '$180k - $220k',
          description: 'We are seeking an expert in zero-knowledge proofs and distributed ledgers to orchestrate the validation engine connecting Cliks SME finance nodes.',
          responsibilities: JSON.stringify([
            'Architect cryptographic proof-of-authority mechanisms for high-throughput transactional logging.',
            'Refine the security primitives of the B2Auth federated identity session layer.',
            'Collaborate with the security auditing team to execute vulnerability scans on ledger operations.',
            'Review and optimize core smart contract and decentralized consensus codebases.'
          ]),
          requirements: JSON.stringify([
            'Ph.D. or equivalent industry research background in Computer Science, Mathematics, or Cryptography.',
            '5+ years of production experience implementing decentralized ledger technologies or distributed systems.',
            'Deep fluency with Rust, Go, or specialized systems engineering languages.',
            'Experience with verifiable credentials and decentralized identity (DID) standards.'
          ]),
          skills: JSON.stringify(['Zero-Knowledge Proofs', 'Cryptography', 'Rust', 'Go', 'Distributed Ledgers', 'WebAuthn'])
        },
        {
          id: 'job-2',
          title: 'Principal Frontend Engineer - React',
          department: 'Engineering',
          location: 'Hybrid',
          type: 'Full-time',
          salary: '$160k - $195k',
          description: 'Shape the next generation of email interaction. Lead the engineering path of the BNXMail group-driven secure client dashboard.',
          responsibilities: JSON.stringify([
            'Drive absolute UI performance, targeting sub-100ms render speeds for high-volume inbox states.',
            'Establish a unified component structure shared across BNXMail, B2Auth, and Cliks Business interfaces.',
            'Collaborate closely with designers to build premium micro-animations and micro-interactions.',
            'Implement real-time WebSocket listeners and optimistic state updates for conversational updates.'
          ]),
          requirements: JSON.stringify([
            '8+ years of experience crafting rich client-side applications using React and Tailwind CSS.',
            'Strong eye for aesthetics, premium typography, responsive grids, and clean design patterns.',
            'Expertise in local caching strategies, service workers, and state synchronization frameworks.',
            'A portfolio showcasing fluid, highly optimized, non-generic user interfaces.'
          ]),
          skills: JSON.stringify(['React', 'Tailwind CSS', 'WebSockets', 'JavaScript', 'HTML/CSS', 'UI/UX'])
        },
        {
          id: 'job-3',
          title: 'Senior Product Designer',
          department: 'Design',
          location: 'Hybrid',
          type: 'Full-time',
          salary: '$135k - $165k',
          description: 'Establish the visual identity of Beta Softnet. Work on high-fidelity designs, user workflows, and cohesive interface layouts.',
          responsibilities: JSON.stringify([
            'Design seamless web and mobile interfaces for complex ledger systems and developer portals.',
            'Conduct user research and build interactive prototypes demonstrating session-switching flows.',
            'Maintain and expand our core design system token database, ensuring maximum visual coherence.',
            'Collaborate with developers to review front-end visual implementation details.'
          ]),
          requirements: JSON.stringify([
            '5+ years of product design experience focusing on SaaS, developer platforms, or complex Fintech tools.',
            'Expertise with Figma, design system governance, and prototyping tools.',
            'A portfolio demonstrating mastery of typography, visual hierarchy, and interface design.',
            'Basic understanding of HTML/CSS/Tailwind configurations is a strong plus.'
          ]),
          skills: JSON.stringify(['Figma', 'Product Design', 'Typography', 'SaaS', 'Prototyping', 'Design Systems'])
        },
        {
          id: 'job-4',
          title: 'Security & Authorization Architect',
          department: 'Security',
          location: 'Remote',
          type: 'Full-time',
          salary: '$170k - $210k',
          description: 'Help harden the core protocols behind B2Auth SSO. Build robust sandboxed session layers and mitigate federated threat models.',
          responsibilities: JSON.stringify([
            'Audit single sign-on authentication vectors and OAuth token-exchange systems.',
            'Design sandbox boundary layers keeping email context secure from transaction nodes.',
            'Establish real-time threat detection telemetry and response pipelines.',
            'Provide security-focused architectural designs for third-party developer APIs.'
          ]),
          requirements: JSON.stringify([
            '6+ years of experience in corporate security, application security, or identity access management (IAM).',
            'Thorough expertise with OAuth 2.1, OIDC, SAML, and WebAuthn standards.',
            'Proven experience auditing cloud systems, Docker containers, and Kubernetes environments.',
            'Relevant security certifications (e.g., CISSP, OSCP) are highly valued.'
          ]),
          skills: JSON.stringify(['OAuth 2.1', 'OIDC', 'WebAuthn', 'IAM', 'Docker', 'Kubernetes', 'Penetration Testing'])
        },
        {
          id: 'job-5',
          title: 'Developer Relations Manager',
          department: 'Product',
          location: 'Remote',
          type: 'Full-time',
          salary: '$120k - $150k',
          description: 'Grow the developer ecosystem using our sandbox APIs. Build outstanding guides, sample apps, and foster the open-source integration community.',
          responsibilities: JSON.stringify([
            'Author highly readable tutorials, API guides, and integration walk-throughs for B2Auth and BNXMail.',
            'Construct and maintain starter repositories and developer SDK boilerplate templates.',
            'Gather developer feedback and coordinate with core product teams to improve the API onboarding flow.',
            'Speak at technology conferences and run online developer sandbox workshops.'
          ]),
          requirements: JSON.stringify([
            '4+ years of developer advocacy or software engineering experience with public APIs.',
            'Excellent technical writing capabilities and communication skills.',
            'Strong coding skills in Javascript/React, Node.js, Python, or Go.',
            'Passion for developer communities, open-source projects, and digital education.'
          ]),
          skills: JSON.stringify(['Developer Relations', 'Technical Writing', 'JavaScript', 'Node.js', 'Go', 'API Design'])
        }
      ];

      for (const job of initialJobs) {
        await client.query(
          `INSERT INTO jobs (id, title, department, location, type, salary, description, responsibilities, requirements, skills)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [job.id, job.title, job.department, job.location, job.type, job.salary, job.description, job.responsibilities, job.requirements, job.skills]
        );
      }
      console.log('Seeding completed successfully.');
    }

  } catch (error) {
    console.error('Error establishing database connection or running initial migration:', error);
    throw error;
  } finally {
    if (client) client.release();
  }

  return pool;
}
