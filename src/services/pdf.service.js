import PDFDocument from 'pdfkit';

export function generateFeeSlipPDF(slipData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const primaryColor = '#1e3a5f';
    const accentColor = '#2563eb';

    // Header background
    doc.rect(0, 0, 595, 120).fill(primaryColor);

    // Logo area
    doc.fontSize(24).fillColor('#ffffff').font('Helvetica-Bold')
      .text(slipData.coachingName, 50, 35);
    doc.fontSize(12).fillColor('#bfdbfe').font('Helvetica')
      .text('Fee Receipt / Slip', 50, 70);

    // Receipt badge
    doc.roundedRect(420, 30, 125, 55, 8)
      .fillAndStroke('#2563eb', '#2563eb');
    doc.fontSize(10).fillColor('#ffffff').font('Helvetica-Bold')
      .text('RECEIPT NO.', 432, 40);
    doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
      .text(slipData.receiptNumber || 'N/A', 432, 56);

    // Status badge
    const statusColor = slipData.status === 'paid' ? '#16a34a' : '#ef4444';
    const statusY = 140;
    doc.roundedRect(50, statusY, 495, 40, 8)
      .fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fontSize(11).fillColor('#64748b').font('Helvetica')
      .text('Payment Status:', 65, 152);
    doc.fontSize(13).fillColor(statusColor).font('Helvetica-Bold')
      .text(slipData.status?.toUpperCase() || 'PENDING', 185, 150);

    // Student Info Section
    doc.fontSize(13).fillColor(primaryColor).font('Helvetica-Bold')
      .text('Student Information', 50, 205);
    doc.moveTo(50, 222).lineTo(545, 222).strokeColor(accentColor).lineWidth(2).stroke();

    const infoY = 232;
    const col1 = 50, col2 = 300;

    function drawField(label, value, x, y) {
      doc.fontSize(9).fillColor('#94a3b8').font('Helvetica').text(label, x, y);
      doc.fontSize(11).fillColor('#1e293b').font('Helvetica-Bold').text(value || 'N/A', x, y + 14);
    }

    drawField('Student Name', slipData.studentName, col1, infoY);
    drawField('Batch', slipData.batchName, col2, infoY);
    drawField('Email', slipData.studentEmail, col1, infoY + 45);
    drawField('Class', slipData.className, col2, infoY + 45);

    // Fee Details Section
    doc.fontSize(13).fillColor(primaryColor).font('Helvetica-Bold')
      .text('Fee Details', 50, 345);
    doc.moveTo(50, 362).lineTo(545, 362).strokeColor(accentColor).lineWidth(2).stroke();

    // Table header
    doc.rect(50, 372, 495, 30).fill('#f1f5f9');
    doc.fontSize(10).fillColor('#475569').font('Helvetica-Bold')
      .text('Description', 65, 382)
      .text('Period', 240, 382)
      .text('Due Date', 350, 382)
      .text('Amount', 470, 382);

    // Table row
    doc.rect(50, 402, 495, 35).fill('#ffffff').stroke('#e2e8f0');
    doc.fontSize(11).fillColor('#1e293b').font('Helvetica')
      .text('Tuition Fee', 65, 413)
      .text(slipData.monthYear || '', 240, 413)
      .text(slipData.dueDate || '', 350, 413)
      .text(`Rs. ${slipData.amount}`, 455, 413);

    // Totals
    doc.rect(370, 447, 175, 35).fill(accentColor);
    doc.fontSize(12).fillColor('#ffffff').font('Helvetica-Bold')
      .text('Total Amount:', 385, 457)
      .text(`Rs. ${slipData.amount}`, 475, 457);

    if (slipData.paidDate) {
      doc.rect(50, 447, 310, 35).fill('#f0fdf4').stroke('#bbf7d0');
      doc.fontSize(10).fillColor('#16a34a').font('Helvetica-Bold')
        .text(`Paid on: ${slipData.paidDate}`, 65, 457);
      if (slipData.paymentId) {
        doc.fontSize(9).fillColor('#16a34a').font('Helvetica')
          .text(`Payment ID: ${slipData.paymentId}`, 65, 470);
      }
    }

    // Footer
    doc.moveTo(50, 520).lineTo(545, 520).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
      .text(`Generated on ${new Date().toLocaleString('en-IN')} | CoachingPro Management System`, 50, 530, { align: 'center' })
      .text('This is a computer-generated receipt and does not require a signature.', 50, 545, { align: 'center' });

    doc.end();
  });
}
