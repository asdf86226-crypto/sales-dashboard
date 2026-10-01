/**
 * 판매현황 배달부 (Google Apps Script)
 * ------------------------------------------------------------------
 * 구글 드라이브 폴더에 있는 판매현황 파일을 읽어 대시보드에 그대로 넘겨준다.
 * 드라이브에 파일만 덮어쓰면 대시보드가 알아서 최신 내용을 받아간다.
 *
 * 최초 1회
 *   1) script.google.com → 새 프로젝트 → 이 코드를 전부 붙여넣고 저장
 *   2) 함수 목록에서 [설정] 을 골라 실행 (구글 권한 승인 필요)
 *      → 실행 로그에 "폴더 주소" 와 "열쇠" 가 나온다
 *   3) 배포 → 새 배포 → 유형: 웹 앱
 *        실행 계정: 나
 *        액세스 권한: 모든 사용자          ← 열쇠로 막으므로 이렇게 둬야 한다
 *      → 배포 후 나오는 웹 앱 URL 복사
 *   4) 대시보드 [🔗 드라이브 연결] 에 URL 과 열쇠를 붙여넣기
 *
 * 그다음부터는 드라이브 폴더에 판매현황 파일을 덮어쓰기만 하면 된다.
 *
 * 주의: 열쇠는 이 스크립트 속성에만 있고 대시보드 저장소에는 없다.
 *       열쇠가 없으면 URL 을 알아도 아무것도 받아갈 수 없다.
 */

var FOLDER_NAME = '구매요청 ERP 자료';   // 구매요청 대시보드가 만들어 둔 폴더
var P = PropertiesService.getScriptProperties();

/** 최초 1회 실행 — 폴더를 찾고 열쇠를 만든다 */
function 설정() {
  var f = 폴더_();
  var key = P.getProperty('SALES_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); P.setProperty('SALES_KEY', key); }

  var picked = '';
  try { var hit = 판매파일_(f); picked = hit ? (hit.getName() + ' (' + 날짜_(hit.getLastUpdated()) + ' 수정)') : '못 찾음'; }
  catch (e) { picked = '확인 실패 — ' + e.message; }

  var m = '[준비 끝]\n\n폴더 : ' + f.getUrl()
        + '\n판매현황 파일 : ' + picked
        + '\n\n열쇠 : ' + key
        + '\n\n이제 [배포 → 새 배포 → 웹 앱] 으로 배포하고,'
        + '\n웹 앱 URL 과 위 열쇠를 대시보드에 넣으세요.';
  Logger.log(m);
  return m;
}

/** 열쇠를 새로 만든다(유출됐을 때). 대시보드에 새 열쇠를 다시 넣어야 한다. */
function 열쇠_새로만들기() {
  var key = Utilities.getUuid().replace(/-/g, '');
  P.setProperty('SALES_KEY', key);
  Logger.log('새 열쇠 : ' + key + '\n\n대시보드에 다시 넣어주세요. 이전 열쇠는 즉시 막힙니다.');
  return key;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.key !== P.getProperty('SALES_KEY')) return 응답_(p.callback, { ok: false, error: '열쇠가 맞지 않습니다.' });

    var f = 폴더_();
    var file = 판매파일_(f);
    if (!file) return 응답_(p.callback, { ok: false, error: '폴더에서 판매현황 파일을 찾지 못했습니다. 파일 이름에 "판매" 를 넣어주세요.' });

    var meta = { ok: true, name: file.getName(), updated: file.getLastUpdated().getTime(), folder: f.getUrl() };
    if (p.sales === 'meta') return 응답_(p.callback, meta);          // 바뀌었는지만 싸게 확인

    var rows = 행읽기_(file);
    if (!rows || !rows.length) return 응답_(p.callback, { ok: false, error: '파일에서 읽을 내용이 없습니다.' });
    meta.rows = rows;
    meta.n = rows.length;
    return 응답_(p.callback, meta);
  } catch (err) {
    return 응답_(p.callback, { ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 폴더 · 파일 찾기 ---------- */
function 폴더_() {
  var id = P.getProperty('SALES_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!it.hasNext()) throw new Error('"' + FOLDER_NAME + '" 폴더를 찾지 못했습니다.');
  var f = it.next();
  P.setProperty('SALES_FOLDER', f.getId());
  return f;
}

/** 이름에 판매·매출이 들어간 파일을 고르고, 같은 점수면 최근에 고친 것을 쓴다 */
function 판매파일_(folder) {
  var it = folder.getFiles(), best = null, bestScore = -1;
  while (it.hasNext()) {
    var f = it.next(), nm = f.getName();
    if (nm.charAt(0) === '~') continue;                       // 엑셀 임시파일
    if (!/\.(xlsx|csv|tsv|txt)$/i.test(nm) &&
        f.getMimeType() !== 'application/vnd.google-apps.spreadsheet') continue;
    var s = /판매|매출|sales/i.test(nm) ? 2 : 0;
    if (/현황|내역/.test(nm)) s += 1;
    if (/재고|bom|소요량|품목등록|기준정보|구매요청/i.test(nm)) s -= 5;   // 다른 용도 파일
    if (s < 0) continue;
    if (s > bestScore || (s === bestScore && best && f.getLastUpdated() > best.getLastUpdated())) {
      best = f; bestScore = s;
    }
  }
  return best;
}

/* ---------- 파일 읽기 (구매요청 대시보드와 같은 방식) ---------- */
function 행읽기_(f) {
  var mt = f.getMimeType(), nm = f.getName(), low = nm.toLowerCase();
  if (mt === 'application/vnd.google-apps.spreadsheet')
    return SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getDisplayValues();
  if (/\.(csv|tsv|txt)$/.test(low) || mt === 'text/csv' || mt === 'text/plain')
    return Utilities.parseCsv(f.getBlob().getDataAsString('UTF-8').replace(/^﻿/, ''));
  if (/\.xlsx$/.test(low) || mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return xlsx_(f.getBlob());
  if (/\.xls$/.test(low)) throw new Error('옛 .xls 형식입니다 — .xlsx 나 CSV 로 저장해 주세요');
  throw new Error('읽을 수 없는 형식입니다: ' + nm);
}

// .xlsx 는 zip 이다. 드라이브 변환을 거치지 않고 여기서 바로 풀어 읽는다.
function xlsx_(blob) {
  var parts;
  try { parts = Utilities.unzip(blob.setContentType('application/zip')); }
  catch (e) { throw new Error('엑셀 파일을 여는 데 실패했습니다 — CSV 로 저장해 올려주세요'); }
  var map = {};
  for (var i = 0; i < parts.length; i++) map[parts[i].getName()] = parts[i];
  var get = function (n) { return map[n] ? map[n].getDataAsString('UTF-8') : ''; };

  // 공유 문자열
  var shared = [], ssx = get('xl/sharedStrings.xml');
  if (ssx) {
    var si = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = si.exec(ssx))) {
      var s = '', t = /<t\b[^>]*>([\s\S]*?)<\/t>/g, x;
      while ((x = t.exec(m[1]))) s += x[1];
      shared.push(unesc_(s));
    }
  }
  // 날짜 서식 (cellStyleXfs 가 아니라 cellXfs 안의 xf 만)
  var dateStyle = [], stx = get('xl/styles.xml');
  if (stx) {
    var fmt = {}, fr = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, f2;
    while ((f2 = fr.exec(stx))) fmt[f2[1]] = unesc_(f2[2]);
    var isDate = function (id) {
      var k = +id; if ((k >= 14 && k <= 22) || (k >= 45 && k <= 47)) return true;
      var c = fmt[id];
      return c ? /[dmy]/i.test(c.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')) : false;
    };
    var cx = stx.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/);
    if (cx) { var xr = /<xf\b[^>]*>/g, xx, i2 = 0;
      while ((xx = xr.exec(cx[0]))) { var id = (xx[0].match(/numFmtId="(\d+)"/) || [])[1] || '0'; dateStyle[i2++] = isDate(id); } }
  }
  var names = [];
  for (var k in map) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) names.push(k);
  if (!names.length) throw new Error('워크시트를 찾을 수 없습니다');
  names.sort();

  var xml = get(names[0]), rows = [];
  var rr = /<row\b[^>]*>([\s\S]*?)<\/row>/g, cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, r;
  while ((r = rr.exec(xml))) {
    var cells = [], c; cr.lastIndex = 0;
    while ((c = cr.exec(r[1]))) {
      var at = c[1] || '', body = c[2] || '';
      var ref = (at.match(/r="([A-Z]+)/) || [])[1] || '';
      var tt = (at.match(/t="([^"]*)"/) || [])[1] || '';
      var st = (at.match(/s="(\d+)"/) || [])[1];
      var col; if (ref) { col = 0; for (var q = 0; q < ref.length; q++) col = col * 26 + (ref.charCodeAt(q) - 64); col--; } else col = cells.length;
      var val = '';
      if (tt === 's') { var v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; val = shared[+v] || ''; }
      else if (tt === 'inlineStr') { var s2 = '', tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
        while ((tm = tr.exec(body))) s2 += tm[1]; val = unesc_(s2); }
      else { var v2 = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        var raw = (v2 == null) ? '' : unesc_(v2);
        val = (raw !== '' && st != null && dateStyle[+st]) ? serial_(+raw) : raw; }
      cells[col] = val;
    }
    for (var j = 0; j < cells.length; j++) if (cells[j] == null) cells[j] = '';
    rows.push(cells);
  }
  return rows;
}

function unesc_(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
    if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    if (e.charAt(0) === '#') { var n = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
      return isFinite(n) ? String.fromCharCode(n) : m; }
    return m;
  });
}
function serial_(n) {
  var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function 날짜_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/* ---------- 응답 ----------
 * 브라우저가 CORS 로 막는 경우를 대비해 JSONP(callback) 도 함께 지원한다. */
function 응답_(callback, obj) {
  var body = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(callback + '(' + body + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}
