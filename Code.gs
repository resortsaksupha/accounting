// ============================================================
//  RESORT STOCK SYSTEM — Google Apps Script Backend v3
//  เพิ่ม: AI อ่านใบเสร็จผ่าน Apps Script (แก้ Load failed)
// ============================================================

const SH = {
  STOCK:   'stock',
  LOG:     'log',
  REVENUE: 'revenue',
  WASTE:   'waste',
};

// ── ใส่ Anthropic API Key ตรงนี้ ──
const ANTHROPIC_KEY = 'ใส่ API Key ของคุณตรงนี้';

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET ──
function doGet(e) {
  const action = e.parameter.action || '';
  let result;
  try {
    switch (action) {
      case 'getStock':   result = getStock();   break;
      case 'getLog':     result = getLog();     break;
      case 'getRevenue': result = getRevenue(); break;
      case 'getWaste':   result = getWaste();   break;
      case 'getSummary': result = getSummary(); break;
      default: result = { ok: true, message: 'Resort Stock API v3 ready' };
    }
  } catch(err) {
    result = { ok: false, error: err.message };
  }
  return jsonResponse(result);
}

// ── POST ──
function doPost(e) {
  let body, result;
  try {
    body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    switch (action) {
      case 'scanReceipt': result = scanReceipt(body.data); break;
      case 'addStock':    result = addStock(body.data);    break;
      case 'addLog':      result = addLog(body.data);      break;
      case 'addRevenue':  result = addRevenue(body.data);  break;
      case 'addWaste':    result = addWaste(body.data);    break;
      case 'bulkAddLog':  result = bulkAddLog(body.data);  break;
      default: result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch(err) {
    result = { ok: false, error: err.message };
  }
  return jsonResponse(result);
}

// ============================================================
//  AI SCAN RECEIPT — เรียก Anthropic API จาก Apps Script
// ============================================================

function scanReceipt(data) {
  const images = data.images || [];
  const pageCount = images.length;

  const prompt = 'คุณคือผู้ช่วยอ่านใบเสร็จระบบสต๊อกรีสอร์ทไทย' +
    (pageCount > 1 ? ' ใบเสร็จมี ' + pageCount + ' หน้า รวมรายการทุกหน้า' : '') +
    '\n\nกฎ:\n' +
    '1. ราคา = ราคารวม VAT (VALUE INCLUDED VAT หรือ จำนวนเงินรวม)\n' +
    '2. Makro POS: QUANTITY มีทศนิยมสูง เช่น 2.382 = น้ำหนัก kg จริง\n' +
    '3. ชื่อสินค้า: ตัดรหัส/บาร์โค้ด ใช้ชื่อสั้นกระชับ\n' +
    '4. ละเว้นรายการส่วนลดและสรุปยอด\n' +
    '5. หน่วย: kg, g, ลิตร, ขวด, ถุง, ชิ้น, ตัว, แผง, ห่อ, กล่อง, ลัง\n\n' +
    'ตอบ JSON เท่านั้น:\n' +
    '{"supplier":"ชื่อร้าน","receipt_no":"เลขใบเสร็จ","receipt_date":"วันที่",' +
    '"items":[{"name":"ชื่อ","qty":0.0,"unit":"หน่วย","price":0.0}],"total":0.0}';

  // สร้าง content blocks สำหรับทุกหน้า
  const contentBlocks = images.map(function(img) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mime || 'image/jpeg',
        data: img.b64
      }
    };
  });
  contentBlocks.push({ type: 'text', text: prompt });

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: contentBlocks }]
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    payload: payload,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const responseData = JSON.parse(response.getContentText());

  if (responseData.error) {
    return { ok: false, error: responseData.error.message };
  }

  const text = responseData.content[0].text;
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);

  return { ok: true, data: parsed };
}

// ============================================================
//  SHEET HELPERS
// ============================================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = createSheet(name);
  return sh;
}

function createSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.insertSheet(name);
  const headers = {
    stock:   ['wh','name','qty','unit','price','date','updatedAt'],
    log:     ['type','wh','name','qty','unit','price','supplier','date','ts'],
    revenue: ['type','bizWH','name','channel','amount','qty','note','date','ts'],
    waste:   ['wh','name','qty','unit','reason','date','ts'],
  };
  if (headers[name]) {
    sh.getRange(1,1,1,headers[name].length).setValues([headers[name]]);
    sh.getRange(1,1,1,headers[name].length)
      .setBackground('#1a9e6e').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function sheetToArray(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(function(row) {
    const obj = {};
    headers.forEach(function(h,i) { obj[h] = row[i]; });
    return obj;
  });
}

// ── STOCK ──
function getStock() { return { ok:true, data:sheetToArray(getSheet(SH.STOCK)) }; }

function addStock(item) {
  const sh = getSheet(SH.STOCK);
  const data = sheetToArray(sh);
  const idx = data.findIndex(function(r) {
    return r.wh===item.wh && r.name===item.name && r.unit===item.unit;
  });
  const now = new Date().toISOString();
  if (idx >= 0) {
    const newQty = (parseFloat(data[idx].qty)||0) + (parseFloat(item.qty)||0);
    sh.getRange(idx+2,3).setValue(newQty);
    sh.getRange(idx+2,5).setValue(item.price||0);
    sh.getRange(idx+2,6).setValue(item.date||'');
    sh.getRange(idx+2,7).setValue(now);
  } else {
    sh.appendRow([item.wh,item.name,item.qty,item.unit,item.price||0,item.date||'',now]);
  }
  return { ok:true };
}

// ── LOG ──
function getLog() { return { ok:true, data:sheetToArray(getSheet(SH.LOG)) }; }

function addLog(item) {
  getSheet(SH.LOG).appendRow([
    item.type||'รับของ',item.wh,item.name,item.qty,item.unit,
    item.price||0,item.supplier||'',item.date||'',item.ts||Date.now()
  ]);
  return { ok:true };
}

function bulkAddLog(items) {
  const sh = getSheet(SH.LOG);
  items.forEach(function(item) {
    sh.appendRow([
      item.type||'รับของ',item.wh,item.name,item.qty,item.unit,
      item.price||0,item.supplier||'',item.date||'',item.ts||Date.now()
    ]);
  });
  return { ok:true, count:items.length };
}

// ── REVENUE ──
function getRevenue() { return { ok:true, data:sheetToArray(getSheet(SH.REVENUE)) }; }

function addRevenue(item) {
  getSheet(SH.REVENUE).appendRow([
    item.type,item.bizWH||'',item.name||'',item.channel||'',
    item.amount,item.qty||1,item.note||'',item.date||'',item.ts||Date.now()
  ]);
  return { ok:true };
}

// ── WASTE ──
function getWaste() { return { ok:true, data:sheetToArray(getSheet(SH.WASTE)) }; }

function addWaste(item) {
  getSheet(SH.WASTE).appendRow([
    item.wh,item.name,item.qty,item.unit,
    item.reason||'',item.date||'',item.ts||Date.now()
  ]);
  const sh = getSheet(SH.STOCK);
  const data = sheetToArray(sh);
  const idx = data.findIndex(function(r) {
    return r.wh===item.wh && r.name===item.name && r.unit===item.unit;
  });
  if (idx >= 0) {
    sh.getRange(idx+2,3).setValue(
      Math.max(0,(parseFloat(data[idx].qty)||0)-(parseFloat(item.qty)||0))
    );
  }
  return { ok:true };
}

// ── SUMMARY ──
function getSummary() {
  const logs     = sheetToArray(getSheet(SH.LOG));
  const revenues = sheetToArray(getSheet(SH.REVENUE));
  const stock    = sheetToArray(getSheet(SH.STOCK));
  const todayStr = Utilities.formatDate(new Date(),'Asia/Bangkok','dd MMM');
  const todayExp = logs.filter(function(l) {
    return l.type==='รับของ' && l.date===todayStr;
  }).reduce(function(s,l) { return s+(parseFloat(l.price)||0); },0);
  const todayRev = revenues.filter(function(r) {
    return r.date===todayStr;
  }).reduce(function(s,r) { return s+(parseFloat(r.amount)||0); },0);
  return { ok:true, data:{
    todayRevenue:todayRev, todayExpense:todayExp,
    todayProfit:todayRev-todayExp,
    totalStockItems:stock.length,
    lowStock:stock.filter(function(s) { return parseFloat(s.qty)<=0; }).length
  }};
}

// ── SETUP ──
function setupSheets() {
  Object.values(SH).forEach(function(name) { getSheet(name); });
  SpreadsheetApp.getUi().alert('✅ สร้าง Sheets เรียบร้อยแล้ว!\n\nSheets: stock, log, revenue, waste');
}
