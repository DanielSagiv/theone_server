const PDFDocument = require('pdfkit');

/**
 * Invoice Service
 * @description Handles invoice generation and formatting
 */

/**
 * Generate invoice number from payment ID
 * @param {string} paymentId - Payment ID
 * @returns {string} Invoice number
 */
function generateInvoiceNumber(paymentId) {
  return `INV-${paymentId.toString().substring(0, 8).toUpperCase()}`;
}

/**
 * Payment method line for invoice HTML/PDF (on-spot uses payer + card copy).
 * @param {object} payment - Invoice `payment` block
 * @returns {string}
 */
function formatInvoicePaymentMethodLine(payment) {
  if (payment?.payment_channel === 'cash') {
    if (payment?.adhoc_payment_summary) {
      return payment.adhoc_payment_summary;
    }
    return 'Cash';
  }
  if (payment?.adhoc_payment_summary) {
    return payment.adhoc_payment_summary;
  }
  const brand = payment?.payment_method?.brand || 'N/A';
  const lastFour = payment?.payment_method?.last_four || 'N/A';
  return `${brand} •••• ${lastFour}`;
}

/**
 * Generate invoice HTML template
 * @param {Object} invoiceData - Invoice data
 * @returns {string} HTML string
 */
function generateInvoiceHTML(invoiceData) {
  const {
    invoice_number,
    invoice_date,
    payment_date,
    status,
    bill_to,
    coe,
    payment,
    pricing,
    refund
  } = invoiceData;
  
  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  
  const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #fff;
      padding: 40px;
    }
    .header {
      margin-bottom: 40px;
      border-bottom: 3px solid #D4AF37;
      padding-bottom: 20px;
    }
    .header h1 {
      color: #D4AF37;
      font-size: 32px;
      margin-bottom: 10px;
    }
    .invoice-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
      flex-wrap: wrap;
    }
    .meta-item {
      margin-right: 30px;
      margin-bottom: 10px;
    }
    .meta-label {
      font-weight: 600;
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-value {
      font-size: 16px;
      color: #333;
      margin-top: 5px;
    }
    .status {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status.paid { background: #d4edda; color: #155724; }
    .status.refunded { background: #fff3cd; color: #856404; }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 15px;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
    }
    .bill-to {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
    }
    .bill-to p {
      margin-bottom: 5px;
    }
    .coe-details {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .coe-details h3 {
      margin-bottom: 10px;
      color: #333;
    }
    .coe-details p {
      color: #666;
      margin-bottom: 10px;
    }
    .events-list {
      list-style: none;
      margin-top: 15px;
    }
    .events-list li {
      padding: 10px;
      background: #fff;
      margin-bottom: 10px;
      border-radius: 4px;
      border-left: 4px solid #D4AF37;
    }
    .pricing-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    .pricing-table th,
    .pricing-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    .pricing-table th {
      background: #f9f9f9;
      font-weight: 600;
      color: #666;
    }
    .pricing-table .total-row {
      background: #f9f9f9;
      font-weight: 600;
      font-size: 18px;
    }
    .pricing-table .total-row td {
      border-top: 2px solid #D4AF37;
      border-bottom: 2px solid #D4AF37;
    }
    .payment-info {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .payment-info p {
      margin-bottom: 8px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #eee;
      text-align: center;
      color: #999;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>THE1 PLATFORM</h1>
    <h2>INVOICE</h2>
    <div class="invoice-meta">
      <div class="meta-item">
        <div class="meta-label">Invoice Number</div>
        <div class="meta-value">${invoice_number}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Invoice Date</div>
        <div class="meta-value">${formatDate(invoice_date)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Payment Date</div>
        <div class="meta-value">${formatDate(payment_date)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status ${status}">${status}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Bill To</div>
    <div class="bill-to">
      <p><strong>${bill_to.name}</strong></p>
      <p>${bill_to.email}</p>
      ${bill_to.phone ? `<p>${bill_to.phone}</p>` : ''}
    </div>
  </div>

  ${coe ? `
  <div class="section">
    <div class="section-title">Experience Details</div>
    <div class="coe-details">
      <h3>${coe.name}</h3>
      ${coe.description ? `<p>${coe.description}</p>` : ''}
      ${coe.events && coe.events.length > 0 ? `
        <ul class="events-list">
          ${coe.events.map(event => `
            <li>
              <strong>${event.event_name}</strong><br>
              ${event.event_date ? `Date: ${formatDate(event.event_date)}<br>` : ''}
              ${event.base_price ? `Price: ${formatCurrency(event.base_price, payment.currency)}` : ''}
            </li>
          `).join('')}
        </ul>
      ` : ''}
    </div>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Pricing Breakdown</div>
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Subtotal</td>
          <td style="text-align: right;">${formatCurrency(pricing.subtotal, payment.currency)}</td>
        </tr>
        ${pricing.taxes > 0 ? `
        <tr>
          <td>Taxes</td>
          <td style="text-align: right;">${formatCurrency(pricing.taxes, payment.currency)}</td>
        </tr>
        ` : ''}
        ${pricing.fees > 0 ? `
        <tr>
          <td>Fees</td>
          <td style="text-align: right;">${formatCurrency(pricing.fees, payment.currency)}</td>
        </tr>
        ` : ''}
        <tr class="total-row">
          <td>Total</td>
          <td style="text-align: right;">${formatCurrency(pricing.total, payment.currency)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Payment Information</div>
    <div class="payment-info">
      <p><strong>Payment Method:</strong> ${formatInvoicePaymentMethodLine(payment)}</p>
      <p><strong>Transaction ID:</strong> ${payment.transaction_id}</p>
      <p><strong>Payment Date:</strong> ${formatDate(payment.completed_at || payment_date)}</p>
      ${refund.refund_amount > 0 ? `
        <p><strong>Refund Amount:</strong> ${formatCurrency(refund.refund_amount, payment.currency)}</p>
        ${refund.refunded_at ? `<p><strong>Refund Date:</strong> ${formatDate(refund.refunded_at)}</p>` : ''}
        ${refund.refund_reason ? `<p><strong>Refund Reason:</strong> ${refund.refund_reason}</p>` : ''}
      ` : ''}
    </div>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>THE1 Platform - Curated Experiences</p>
  </div>
</body>
</html>
  `;
  
  return html.trim();
}

/**
 * Generate invoice PDF
 * @param {Object} invoiceData - Invoice data
 * @param {Object} options - PDF options
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateInvoicePDF(invoiceData, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      // Header
      doc.fontSize(24)
         .fillColor('#D4AF37')
         .text('THE1 PLATFORM', { align: 'left' });
      
      doc.fontSize(18)
         .fillColor('#333')
         .text('INVOICE', { align: 'left' })
         .moveDown();
      
      // Invoice metadata
      doc.fontSize(10)
         .fillColor('#666')
         .text('Invoice Number:', { continued: true })
         .fillColor('#333')
         .fontSize(12)
         .text(` ${invoiceData.invoice_number}`);
      
      doc.fontSize(10)
         .fillColor('#666')
         .text('Invoice Date:', { continued: true })
         .fillColor('#333')
         .fontSize(12)
         .text(` ${new Date(invoiceData.invoice_date).toLocaleDateString()}`);
      
      doc.fontSize(10)
         .fillColor('#666')
         .text('Payment Date:', { continued: true })
         .fillColor('#333')
         .fontSize(12)
         .text(` ${new Date(invoiceData.payment_date).toLocaleDateString()}`);
      
      doc.fontSize(10)
         .fillColor('#666')
         .text('Status:', { continued: true })
         .fillColor('#333')
         .fontSize(12)
         .text(` ${invoiceData.status.toUpperCase()}`)
         .moveDown(2);
      
      // Bill To
      doc.fontSize(14)
         .fillColor('#333')
         .text('Bill To:', { underline: true })
         .moveDown(0.5);
      
      doc.fontSize(12)
         .text(`${invoiceData.bill_to.name}`)
         .text(`${invoiceData.bill_to.email}`);
      
      if (invoiceData.bill_to.phone) {
        doc.text(`${invoiceData.bill_to.phone}`);
      }
      
      doc.moveDown();
      
      // COE Details
      if (invoiceData.coe) {
        doc.fontSize(14)
           .text('Experience Details:', { underline: true })
           .moveDown(0.5);
        
        doc.fontSize(12)
           .font('Helvetica-Bold')
           .text(invoiceData.coe.name)
           .font('Helvetica');
        
        if (invoiceData.coe.description) {
          doc.text(invoiceData.coe.description)
             .moveDown(0.5);
        }
        
        if (invoiceData.coe.events && invoiceData.coe.events.length > 0) {
          invoiceData.coe.events.forEach(event => {
            doc.text(`${event.event_name}`, { indent: 20 });
            if (event.event_date) {
              doc.text(`Date: ${new Date(event.event_date).toLocaleDateString()}`, { indent: 20 });
            }
            if (event.base_price) {
              doc.text(`Price: $${event.base_price.toFixed(2)}`, { indent: 20 });
            }
            doc.moveDown(0.5);
          });
        }
        
        doc.moveDown();
      }
      
      // Pricing Breakdown
      doc.fontSize(14)
         .text('Pricing Breakdown:', { underline: true })
         .moveDown(0.5);
      
      const tableTop = doc.y;
      const tableLeft = 50;
      const col1Width = 400;
      const col2Width = 100;
      
      // Table headers
      doc.fontSize(10)
         .fillColor('#666')
         .text('Description', tableLeft, tableTop)
         .text('Amount', tableLeft + col1Width, tableTop, { align: 'right', width: col2Width });
      
      let yPos = tableTop + 20;
      
      // Subtotal
      doc.fontSize(12)
         .fillColor('#333')
         .text('Subtotal', tableLeft, yPos)
         .text(`$${invoiceData.pricing.subtotal.toFixed(2)}`, tableLeft + col1Width, yPos, { align: 'right', width: col2Width });
      yPos += 20;
      
      // Taxes
      if (invoiceData.pricing.taxes > 0) {
        doc.text('Taxes', tableLeft, yPos)
           .text(`$${invoiceData.pricing.taxes.toFixed(2)}`, tableLeft + col1Width, yPos, { align: 'right', width: col2Width });
        yPos += 20;
      }
      
      // Fees
      if (invoiceData.pricing.fees > 0) {
        doc.text('Fees', tableLeft, yPos)
           .text(`$${invoiceData.pricing.fees.toFixed(2)}`, tableLeft + col1Width, yPos, { align: 'right', width: col2Width });
        yPos += 20;
      }
      
      // Total
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .moveTo(tableLeft, yPos)
         .lineTo(tableLeft + col1Width + col2Width, yPos)
         .stroke()
         .moveDown(0.5);
      
      yPos += 10;
      
      doc.text('Total', tableLeft, yPos)
         .text(`$${invoiceData.pricing.total.toFixed(2)}`, tableLeft + col1Width, yPos, { align: 'right', width: col2Width });
      
      doc.moveDown(2);
      
      // Payment Information
      doc.fontSize(14)
         .text('Payment Information:', { underline: true })
         .moveDown(0.5);
      
      doc.fontSize(12)
         .text(`Payment Method: ${formatInvoicePaymentMethodLine(invoiceData.payment)}`)
         .text(`Transaction ID: ${invoiceData.payment.transaction_id}`)
         .text(`Payment Date: ${new Date(invoiceData.payment.completed_at || invoiceData.payment_date).toLocaleDateString()}`);
      
      if (invoiceData.refund.refund_amount > 0) {
        doc.moveDown(0.5)
           .text(`Refund Amount: $${invoiceData.refund.refund_amount.toFixed(2)}`);
        
        if (invoiceData.refund.refunded_at) {
          doc.text(`Refund Date: ${new Date(invoiceData.refund.refunded_at).toLocaleDateString()}`);
        }
        
        if (invoiceData.refund.refund_reason) {
          doc.text(`Refund Reason: ${invoiceData.refund.refund_reason}`);
        }
      }
      
      doc.moveDown(2);
      
      // Footer
      doc.fontSize(10)
         .fillColor('#999')
         .text('Thank you for your business!', { align: 'center' })
         .text('THE1 Platform - Curated Experiences', { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateInvoiceNumber,
  generateInvoiceHTML,
  generateInvoicePDF
};












