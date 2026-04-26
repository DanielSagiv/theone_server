## Feature: Website Contact Form Email Submission

### 1. Goal

Enable visitors of the **public website** to submit the **Contact** form and have the submission sent as an email to a configured recipient, using the existing AWS SES–based `emailService`.

- The user fills in the contact form on `/website/contact`.
- On submit, the form is validated in the browser, sent to the backend as JSON, and an email is dispatched.
- The endpoint returns a **JSON** status so the frontend can show success/error feedback without a full page reload.

---

### 2. Existing Behavior (Context)

- **Frontend**
  - `website/contact.html` already exists and renders:
    - Fields: `name`, `email`, `phone`, `subject`, `message`.
    - Submit button: “Send Message”.
  - There is currently **no JavaScript** wired to submit the form via AJAX.

- **Backend**
  - `routes/website.js` exposes:
    - `GET /website` → `index.html`
    - `GET /website/vision` → `vision.html`
    - `GET /website/experience` → `experience.html`
    - `GET /website/membership` → `membership.html`
    - `GET /website/contact` → `contact.html`
    - `GET /website/terms` → `terms.html`
    - `GET /website/privacy` → `privacy.html`
  - All website routes are behind `requireWebsitePasswordAuth`.
  - There is **no `POST /website/contact`** yet.

- **Email Infrastructure**
  - `utils/emailService.js` already exists and is wired to AWS SES (used for other flows like verification, etc.).
  - There are existing patterns for:
    - Building email content (subject/body).
    - Sending via SES with proper error handling.

---

### 3. High‑Level Design

#### 3.1 Backend API

- Add a **new POST endpoint**:
  - `POST /website/contact`
  - Auth: same `requireWebsitePasswordAuth` middleware as the other website routes (consistent with overall website access policy).
  - Request body (JSON):
    - `name` (string, required)
    - `email` (string, required, valid email format)
    - `phone` (string, optional)
    - `subject` (string, required)
    - `message` (string, required)
  - Behavior:
    1. Validate payload (basic checks or via a small Joi schema; reuse patterns from `utils/validationSchemas.js` where appropriate).
    2. Build an email payload for `emailService`:
       - **To**: `process.env.CONTACT_EMAIL` (must be configured in `.env` and `.env.example`).
       - **From**: existing “no-reply” or system address already configured in `emailService`.
       - **Subject**: e.g. `[THE1 Website Contact] ${subject}`.
       - **Body** (HTML or text): includes name, email, phone, message, timestamp.
    3. Call a dedicated helper in `emailService` (e.g. `sendContactFormEmail(formData)`), which wraps the SES call.
    4. Return a JSON response:
       - On success: `200` → `{ success: true }`.
       - On validation error: `400` → `{ success: false, error: '...' , details: { ... } }`.
       - On email send failure: `500` → `{ success: false, error: 'Failed to send message' }`.

#### 3.2 Frontend Behavior

- Enhance `website/contact.html` with a small inline `<script>`:
  - Attach a `submit` handler to `.contact-form`:
    1. `e.preventDefault()`.
    2. Read form fields into a `formData` object.
    3. Optionally run quick client-side validation (e.g. non-empty, basic email regex).
    4. Disable the submit button and change its text to “Sending…” while the request is in flight.
    5. `fetch('/website/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) })`.
    6. On `success: true`:
       - Show a success message (small text area below the form).
       - Optionally clear the form fields.
       - Re-enable the button and reset its label.
    7. On error (non-200 status or `success: false` in JSON):
       - Show an error message.
       - Re-enable the button and reset its label.
  - Keep the UI and typography consistent with the existing website styling in `website/assets/css/style.css`.

---

### 4. Detailed Backend Plan

**File:** `routes/website.js`

1. **Imports**
   - Import the email helper:
     - `const { sendContactFormEmail } = require('../utils/emailService');`  
       (or a similarly named function if we follow existing emailService patterns).

2. **Route Implementation**

```js
/**
 * POST /website/contact
 * Handle contact form submission: validate input and send email via AWS SES.
 */
router.post('/contact', requireWebsitePasswordAuth, async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body || {};

    // Basic validation (can be upgraded to Joi):
    const errors = {};
    if (!name || !name.trim()) errors.name = 'Name is required';
    if (!email || !email.trim()) errors.email = 'Email is required';
    if (!subject || !subject.trim()) errors.subject = 'Subject is required';
    if (!message || !message.trim()) errors.message = 'Message is required';

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }

    await sendContactFormEmail({ name, email, phone, subject, message });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error handling contact form submission:', error);
    return res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});
```

3. **Email Service Helper**

**File:** `utils/emailService.js`

- Add a **new exported function**, following existing style:

```js
/**
 * Send website contact form submission email to CONTACT_EMAIL recipient.
 * @param {Object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} [data.phone]
 * @param {string} data.subject
 * @param {string} data.message
 * @returns {Promise<void>}
 */
async function sendContactFormEmail(data) {
  const recipient = process.env.CONTACT_EMAIL;
  if (!recipient) {
    console.warn('[EMAIL] CONTACT_EMAIL is not configured, skipping contact form email send');
    return;
  }

  const { name, email, phone, subject, message } = data;

  const emailSubject = `[THE1 Website Contact] ${subject}`;
  const emailBody = `
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
    <p><strong>Message:</strong></p>
    <p>${message.replace(/\\n/g, '<br>')}</p>
  `;

  // Reuse the existing generic sendEmail / sendHtmlEmail helper in emailService
  await sendHtmlEmail({
    to: recipient,
    subject: emailSubject,
    html: emailBody,
  });
}
```

- Export `sendContactFormEmail` in the module’s exports object.
- Ensure it uses the **same SES client and error handling** as other email functions.

4. **Environment Configuration**

- Add to `.env.example`:

```bash
# Website contact form recipient
CONTACT_EMAIL=
```

- In deployment (AWS ECS / other), set `CONTACT_EMAIL` to the desired destination address.

---

### 5. Detailed Frontend Plan

**File:** `website/contact.html`

1. **Form Markup**  
   - Already present; ensure the form has a class `contact-form` and the inputs have IDs:
     - `#contact-name`, `#contact-email`, `#contact-phone`, `#contact-subject`, `#contact-message`.

2. **Client-Side Script**

- At the bottom of `<body>`, add:

```html
<script>
  document.addEventListener('DOMContentLoaded', function () {
    const form = document.querySelector('.contact-form');
    if (!form) return;

    const submitBtn = form.querySelector('.contact-submit-btn');
    const statusEl = document.createElement('div');
    statusEl.className = 'contact-status-message';
    form.appendChild(statusEl);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      const name = document.getElementById('contact-name').value.trim();
      const email = document.getElementById('contact-email').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const subject = document.getElementById('contact-subject').value.trim();
      const message = document.getElementById('contact-message').value.trim();

      // Basic client-side validation
      if (!name || !email || !subject || !message) {
        statusEl.textContent = 'Please fill in all required fields.';
        statusEl.classList.remove('success');
        statusEl.classList.add('error');
        return;
      }

      submitBtn.disabled = true;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';
      statusEl.textContent = '';

      try {
        const resp = await fetch('/website/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name, email, phone, subject, message })
        });

        const data = await resp.json().catch(() => ({}));

        if (resp.ok && data.success) {
          statusEl.textContent = 'Thank you. Your message has been sent.';
          statusEl.classList.remove('error');
          statusEl.classList.add('success');
          form.reset();
        } else {
          statusEl.textContent = data.error || 'There was a problem sending your message. Please try again.';
          statusEl.classList.remove('success');
          statusEl.classList.add('error');
        }
      } catch (err) {
        console.error('Error submitting contact form:', err);
        statusEl.textContent = 'There was a problem sending your message. Please try again.';
        statusEl.classList.remove('success');
        statusEl.classList.add('error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  });
</script>
```

3. **Styling (Optional)**

- In `website/assets/css/style.css`, add minimal styles for the status element:

```css
.contact-status-message {
  margin-top: 1rem;
  font-size: 0.9rem;
}

.contact-status-message.success {
  color: #4ade80; /* green-ish */
}

.contact-status-message.error {
  color: #f87171; /* red-ish */
}
```

---

### 6. Error Handling & Logging

- Wrap the backend logic in `try/catch`:
  - Log errors with `console.error('Error handling contact form submission:', error);`.
  - Never expose internal stack traces to the client; only send user-friendly messages.
- If `CONTACT_EMAIL` is missing:
  - Log a warning and either:
    - Short-circuit the email send but still return success (development mode), or
    - Return a clear `500` error (production) depending on project policy.

---

### 7. Testing Plan

1. **Local Happy Path**
   - Configure `CONTACT_EMAIL` in `.env`.
   - Start the server, log in to the website, open `/website/contact`.
   - Fill all fields with valid values, submit.
   - Expect:
     - Button shows “Sending…” and is disabled while sending.
     - Success message appears.
     - Email arrives at `CONTACT_EMAIL`.

2. **Validation Errors**
   - Leave required fields empty, click submit.
   - Expect client-side message: “Please fill in all required fields.”
   - Optionally simulate server-side validation by hacking the request (e.g., via dev tools) and verify `400` JSON response.

3. **Server Error Simulation**
   - Temporarily break SES credentials or set `CONTACT_EMAIL` to an invalid address.
   - Submit the form.
   - Expect:
     - Backend logs an error.
     - Frontend shows a generic error message.

4. **Auth Behavior**
   - Try accessing `/website/contact` without passing website password (if applicable in this environment).
   - Confirm route is still protected via `requireWebsitePasswordAuth`.

---

### 8. Notes / Non‑Goals

- This feature only **sends an email**; it does **not** persist contact submissions in the database.
- No changes are made to the general website layout/UX beyond:
  - The inline JavaScript for the contact form.
  - A small status message area and optional CSS.
- We **reuse** the existing `emailService` and SES configuration rather than introducing any new email provider or transport.


