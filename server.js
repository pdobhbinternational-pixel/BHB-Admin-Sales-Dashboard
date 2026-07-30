require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_COOKIE = 'bhb_session';

// Initialize Supabase Client
// IMPORTANT: this must be the SERVICE ROLE key. RLS is enabled on every
// table with no anon/authenticated policies, so the service role key is
// the only credential that can read or write anything.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables!");
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET environment variable!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// SMTP Transporter Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==========================================
// AUTH HELPERS
// ==========================================

function issueSessionCookie(res, admin) {
  const token = jwt.sign({ sub: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
}

function verifySession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Protects browser page routes (e.g. the dashboard) — redirects to login
function requirePageAuth(req, res, next) {
  const session = verifySession(req);
  if (!session) return res.redirect('/login.html');
  req.admin = session;
  next();
}

// Protects JSON API routes — returns 401 instead of redirecting
function requireApiAuth(req, res, next) {
  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  req.admin = session;
  next();
}

// ==========================================
// PROTECTED PAGE ROUTES (must be registered BEFORE express.static so
// they take priority over the static file handler for these exact paths)
// ==========================================

// Public landing page — this is the storefront homepage, no login required
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Admin dashboard stays fully protected at /index.html (unchanged file,
// unchanged behavior — login.html already redirects here after login)
app.get('/index.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Everything else (login page, forms, css, js, graphics) is public/static
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ==========================================
// 0. AUTHENTICATION
// ==========================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('*')
      .ilike('email', email.trim())
      .maybeSingle();

    if (error) throw error;
    if (!admin) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    issueSessionCookie(res, admin);
    res.json({ success: true, message: 'Login successful' });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/session', (req, res) => {
  const session = verifySession(req);
  res.json({ authenticated: !!session, email: session?.email || null });
});

// ==========================================
// 1. DASHBOARD & SYSTEM METRICS  (admin, protected)
// ==========================================

app.get('/api/admin/metrics', requireApiAuth, async (req, res) => {
  try {
    const { count: totalInquiries, error: errInq } = await supabase
      .from('inquiries')
      .select('*', { count: 'exact', head: true });

    const { count: totalPending, error: errPending } = await supabase
      .from('inquiries')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { data: busData, error: errBus } = await supabase
      .from('businesses')
      .select('bookings');

    const totalBookings = busData ? busData.reduce((acc, curr) => acc + (curr.bookings || 0), 0) : 0;

    const { count: totalPromoters, error: errProm } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true });

    if (errInq || errPending || errBus || errProm) {
      throw new Error('Error fetching system metrics');
    }

    res.json({
      totalInquiries: totalInquiries || 0,
      totalPending: totalPending || 0,
      totalBookings: totalBookings || 0,
      totalPromoters: totalPromoters || 0
    });
  } catch (err) {
    console.error('Metrics Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. INQUIRIES ENDPOINTS  (admin, protected)
// ==========================================

app.get('/api/admin/inquiries', requireApiAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;

    let query = supabase
      .from('inquiries')
      .select('id, fname, lname, email, phone, referral_code, status, created_at, business_id, details, businesses(bname)')
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Fetch Inquiries Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update Inquiry Status (Pending -> Booked / Cancelled)
app.patch('/api/admin/inquiries/:id/status', requireApiAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'cancelled', 'booked'].includes(status?.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid status choice.' });
    }

    // Updating status triggers the Postgres function handle_inquiry_status_change(),
    // which increments/decrements businesses.bookings and employees.pull_ins.
    const { data, error } = await supabase
      .from('inquiries')
      .update({ status: status.toLowerCase() })
      .eq('id', id)
      .select();

    if (error) throw error;

    res.json({ message: 'Inquiry status updated successfully', data });
  } catch (err) {
    console.error('Update Status Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. PUBLIC FORM & INQUIRY SUBMISSION  (public, no auth — this is the
//    route all 3 client-facing forms submit to)
// ==========================================

app.post('/api/public/inquiry', async (req, res) => {
  try {
    const body = { ...req.body };

    // Honeypot: silently pretend success so bots don't learn anything
    if (body.website_hp) {
      return res.status(201).json({ message: 'Inquiry submitted successfully!' });
    }

    const { business_slug, promoterCode, name, email, phone, website_hp, ...details } = body;

    if (!business_slug || !name) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Resolve business by slug (set per-form, not a hardcoded UUID)
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, bname')
      .eq('slug', business_slug)
      .maybeSingle();

    if (bizErr) throw bizErr;
    if (!business) return res.status(400).json({ error: 'Unknown business/service.' });

    // Resolve referral code -> employee (defaults to 'Direct' if blank/invalid)
    let referral_code = 'Direct';
    let employee_id = null;
    const cleanedRef = (promoterCode || '').replace(/\(No Referral\)/i, '').trim();

    if (cleanedRef && cleanedRef.toLowerCase() !== 'direct') {
      const { data: emp } = await supabase
        .from('employees')
        .select('id, referral_code')
        .ilike('referral_code', cleanedRef)
        .maybeSingle();

      if (emp) {
        referral_code = emp.referral_code;
        employee_id = emp.id;
      }
    }

    const rawName = (name || '').trim();
    const nameParts = rawName.split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';

    const { data: inquiry, error: insErr } = await supabase
      .from('inquiries')
      .insert([{
        business_id: business.id,
        employee_id,
        referral_code,
        fname,
        lname,
        email: email || null,
        phone: phone || null,
        status: 'pending',
        details
      }])
      .select()
      .single();

    if (insErr) throw insErr;

    // Fire-and-forget emails so the client isn't kept waiting on SMTP
    sendBossNotification({ business, referral_code, fname, lname, email, phone, details })
      .catch(mailErr => console.error('Boss notification email failed:', mailErr));

    if (email) {
      sendClientConfirmation({ business, fname, email })
        .catch(mailErr => console.error('Client confirmation email failed:', mailErr));
    }

    res.status(201).json({ message: 'Inquiry submitted successfully!', data: inquiry });
  } catch (err) {
    console.error('Submit Inquiry Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch business list for inquiry dropdowns / slug resolution
app.get('/api/public/businesses', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, slug, bname')
      .order('bname', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EMAIL TEMPLATES
// ==========================================

function detailsToRows(details) {
  return Object.entries(details || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();
      return `<tr><td style="padding: 6px 0; font-weight: bold; color: #475569; vertical-align: top; white-space: nowrap;">${label}:</td><td style="padding: 6px 0 6px 12px;">${String(value)}</td></tr>`;
    })
    .join('');
}

async function sendBossNotification({ business, referral_code, fname, lname, email, phone, details }) {
  const bossEmail = process.env.BOSS_EMAIL;
  if (!bossEmail) return;

  const mailOptions = {
    from: `"BHB System Notifications" <${process.env.SMTP_USER}>`,
    to: bossEmail,
    subject: `New Inquiry — ${business.bname} — Ref: ${referral_code}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">New Client Inquiry Notification</h2>
        <p>A new inquiry has been submitted through the ${business.bname} form.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Client Name:</td><td style="padding: 6px 0 6px 12px;">${fname} ${lname || ''}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Business Unit:</td><td style="padding: 6px 0 6px 12px;">${business.bname}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Email:</td><td style="padding: 6px 0 6px 12px;">${email || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Phone:</td><td style="padding: 6px 0 6px 12px;">${phone || 'N/A'}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Referral Code:</td><td style="padding: 6px 0 6px 12px;"><span style="background-color: #e0e7ff; color: #3730a3; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${referral_code}</span></td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Status:</td><td style="padding: 6px 0 6px 12px;"><span style="background-color: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 4px; font-weight: bold;">Pending</span></td></tr>
          <tr><td style="padding: 6px 0; font-weight: bold; color: #475569; white-space: nowrap;">Submitted:</td><td style="padding: 6px 0 6px 12px;">${new Date().toLocaleString()}</td></tr>
          ${detailsToRows(details)}
        </table>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

async function sendClientConfirmation({ business, fname, email }) {
  const mailOptions = {
    from: `"BHB International" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `We received your ${business.bname} inquiry`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">Thank you, ${fname || 'there'}!</h2>
        <p>We've received your inquiry for <strong>${business.bname}</strong> and a member of our team will reach out to you shortly.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">If you didn't submit this request, you can safely ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

// ==========================================
// 4. DYNAMIC FORM CONFIGURATION APIS
// ==========================================

app.get('/api/public/form-config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('form_configs')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/form-config', requireApiAuth, async (req, res) => {
  try {
    const { form_title, form_subtitle, primary_color, field_fname_label, field_lname_label, field_lname_required, custom_fields } = req.body;

    const { data: existing } = await supabase.from('form_configs').select('id').limit(1).maybeSingle();

    let result;
    if (existing?.id) {
      result = await supabase
        .from('form_configs')
        .update({
          form_title,
          form_subtitle,
          primary_color,
          field_fname_label,
          field_lname_label,
          field_lname_required,
          custom_fields,
          updated_at: new Date()
        })
        .eq('id', existing.id)
        .select();
    } else {
      result = await supabase
        .from('form_configs')
        .insert([{ form_title, form_subtitle, primary_color, field_fname_label, field_lname_label, field_lname_required, custom_fields }])
        .select();
    }

    if (result.error) throw result.error;
    res.json({ message: 'Form configuration updated successfully', data: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. LEADERBOARD ENDPOINT  (admin, protected)
// ==========================================

app.get('/api/admin/leaderboard', requireApiAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('id, fname, lname, referral_code, pull_ins')
      .order('pull_ins', { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Fetch Leaderboard Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. BUSINESSES ENDPOINTS  (admin, protected)
// ==========================================

app.get('/api/admin/businesses', requireApiAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/businesses', requireApiAuth, async (req, res) => {
  try {
    const { bname, bookings, slug } = req.body;

    if (!bname || !bname.trim()) {
      return res.status(400).json({ error: 'Business name is required.' });
    }

    const cleanSlug = (slug || '').trim().toLowerCase();
    if (!cleanSlug || !/^[a-z0-9-]+$/.test(cleanSlug)) {
      return res.status(400).json({ error: 'Slug is required and can only contain lowercase letters, numbers, and hyphens.' });
    }

    const { data, error } = await supabase
      .from('businesses')
      .insert([{ bname: bname.trim(), slug: cleanSlug, bookings: parseInt(bookings) || 0 }])
      .select();

    if (error) {
      // Postgres unique_violation — most likely the slug already exists
      if (error.code === '23505') {
        return res.status(409).json({ error: `That slug is already taken by another business. Choose a different one.` });
      }
      throw error;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Create Business Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/businesses/:id', requireApiAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { bname, bookings } = req.body;
    const { data, error } = await supabase
      .from('businesses')
      .update({ bname, bookings: parseInt(bookings) || 0 })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/businesses/:id', requireApiAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('businesses').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Business deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. EMPLOYEES ENDPOINTS  (admin, protected)
// ==========================================

app.get('/api/admin/employees', requireApiAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/employees', requireApiAuth, async (req, res) => {
  try {
    const { fname, lname, referral_code, pull_ins } = req.body;
    const { data, error } = await supabase
      .from('employees')
      .insert([{ fname, lname, referral_code, pull_ins: parseInt(pull_ins) || 0 }])
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/employees/:id', requireApiAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fname, lname, referral_code, pull_ins } = req.body;
    const { data, error } = await supabase
      .from('employees')
      .update({ fname, lname, referral_code, pull_ins: parseInt(pull_ins) || 0 })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/employees/:id', requireApiAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Employee deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server executing on port ${PORT}`);
});