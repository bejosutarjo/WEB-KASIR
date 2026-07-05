/* ============================================================
   qris.js — Konversi QRIS statis -> QRIS dinamis (nominal terisi)
   Mengikuti struktur standar EMVCo QR Code (TLV: Tag-Length-Value)
   yang dipakai QRIS Indonesia.
   ============================================================ */

const QRIS = (() => {

  // Parse string TLV menjadi array {tag, length, value}
  function parseTLV(str) {
    const out = [];
    let i = 0;
    while (i < str.length) {
      const tag = str.substr(i, 2);
      const len = parseInt(str.substr(i + 2, 2), 10);
      const value = str.substr(i + 4, len);
      out.push({ tag, len, value });
      i += 4 + len;
    }
    return out;
  }

  function buildTLV(fields) {
    return fields.map(f => {
      const len = f.value.length.toString().padStart(2, '0');
      return f.tag + len + f.value;
    }).join('');
  }

  // CRC16-CCITT (poly 0x1021, init 0xFFFF) — dipakai tag 63 pada QRIS/EMV QR
  function crc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
      crc ^= str.charCodeAt(c) << 8;
      for (let i = 0; i < 8; i++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Membuat QRIS dinamis dari QRIS statis + nominal transaksi.
   * @param {string} staticQris - string QRIS statis milik toko
   * @param {number} amount - nominal yang harus dibayar (Rupiah, bulat)
   * @returns {string} string QRIS dinamis siap di-generate jadi QR image
   */
  function makeDynamic(staticQris, amount) {
    let fields = parseTLV(staticQris.trim());

    // buang tag 63 (CRC) lama, akan dihitung ulang di akhir
    fields = fields.filter(f => f.tag !== '63');

    // tag 01 = Point of Initiation Method: 11 = statis, 12 = dinamis
    fields = fields.map(f => f.tag === '01' ? { ...f, value: '12' } : f);

    // tag 54 = Transaction Amount, harus disisipkan sebelum tag 58 (Country Code)
    const amountStr = Number(amount).toFixed(2);
    const amountField = { tag: '54', value: amountStr };

    const idx58 = fields.findIndex(f => f.tag === '58');
    const already54 = fields.findIndex(f => f.tag === '54');
    if (already54 !== -1) fields.splice(already54, 1);

    const insertAt = idx58 !== -1 ? idx58 : fields.length;
    fields.splice(insertAt, 0, amountField);

    // susun ulang jadi string, tambahkan placeholder tag 63 (CRC) length 04
    let payload = buildTLV(fields);
    payload += '6304'; // tag 63, length 4, value menyusul dari CRC
    const crc = crc16(payload);
    return payload + crc;
  }

  return { makeDynamic, parseTLV, crc16 };
})();
